import type {
  ConnectionConstructorOptions,
  QueueFailureAcknowledgement,
  QueueMessage,
  QueueSuccessAcknowledgement,
} from '@jakguru/amqplib-oop'
import { Connection } from '@jakguru/amqplib-oop'
import type {
  AxiosAdapter,
  AxiosProgressEvent,
  AxiosPromise,
  AxiosResponse,
  CustomParamsSerializer,
  InternalAxiosRequestConfig,
  ParamsSerializerOptions,
  FormDataVisitorHelpers,
} from 'axios'
import { AxiosError, CanceledError } from 'axios'
import qs from 'qs'
import { v4 as uuidv4 } from 'uuid'
import FormData from 'form-data'
import { deserialize } from 'v8'
const debug = require('debug')

const log = debug('amqplib-oop-axios:adapter')

/**
 * Configuration options for the AmqplibAxiosAdapterManager
 */
export type AmqplibAxiosAdapterManagerConfiguration =
  | Partial<ConnectionConstructorOptions>
  | Connection

interface AxiosProgressEventHandler {
  (progressEvent: AxiosProgressEvent): void
}

type BuildUrlParamsSerializerOptions = ParamsSerializerOptions | CustomParamsSerializer

const onAxiosProgressEventMessage = async (
  handler: AxiosProgressEventHandler | undefined,
  msg: QueueMessage,
  ack: QueueSuccessAcknowledgement,
  nack: QueueFailureAcknowledgement
) => {
  if (handler) {
    let parsed: AxiosProgressEvent | undefined
    try {
      parsed = deserialize(msg.content)
    } catch {
      nack(false)
    }
    if (!parsed) {
      nack(false)
    }
    try {
      await handler(parsed!)
      ack()
    } catch {
      nack(true)
    }
  } else {
    nack(false)
  }
}

const toArray = (thing) => {
  if (!thing) return null
  if (Array.isArray(thing)) return thing
  let i = thing.length
  if ('number' !== typeof i) return null
  const arr = new Array(i)
  while (i-- > 0) {
    arr[i] = thing[i]
  }
  return arr
}

const visitorHelpers: FormDataVisitorHelpers = {
  isVisitable: (val) => 'object' === typeof val && val !== null,
  convertValue: (val) => {
    if (null === val) {
      return ''
    }
    if (val instanceof Date) {
      return val.toISOString()
    }
    if (val instanceof ArrayBuffer || val instanceof Uint8Array) {
      return Buffer.from(val)
    }
    return val
  },
  defaultVisitor: (value, key, path) => {
    let arr = value

    if (value && !path && typeof value === 'object') {
      if (key.toString().endsWith('{}')) {
        key = key.toString().slice(0, -2)
        value = JSON.stringify(value)
      } else if (
        (Array.isArray(value) && !arr.some((v) => 'object' === typeof v && v !== null)) ||
        (key.toString().endsWith('[]') && (arr = toArray(value)))
      ) {
        key = key.toString().endsWith('[]') ? key.toString().slice(0, -2) : key
        return false
      }
    }
    if ('object' === typeof value && null !== value) {
      return true
    }
    return false
  },
}

const buildUrlWithParams = (
  url?: string | undefined,
  params?: Record<string, any> | undefined,
  options?: BuildUrlParamsSerializerOptions | undefined
): string | undefined => {
  if (!url || !params) {
    return url
  }

  // If options is a function, use it directly to serialize params
  if (typeof options === 'function') {
    return `${url}?${options(params)}`
  }

  // If options is an object with a serialize method, use it
  if (options && 'serialize' in options && typeof options.serialize === 'function') {
    return `${url}?${options.serialize(params, options)}`
  }

  // Function to handle serialization recursively
  const serialize = (obj: any, parentKey: string | null = null, path: string[] = []) => {
    const result: [string, any][] = []

    Object.keys(obj).forEach((key) => {
      let fullPath = parentKey ? `${parentKey}[${key}]` : key
      if (options?.metaTokens && typeof obj[key] === 'object' && obj[key] !== null) {
        fullPath += '{}'
      }

      if (options?.visitor) {
        const formData = new FormData()
        const customValue = options.visitor.apply(formData, [
          obj[key],
          fullPath,
          path.concat([key]),
          visitorHelpers,
        ])
        result.push([fullPath, customValue])
      } else if (
        typeof obj[key] === 'object' &&
        obj[key] !== null &&
        !ArrayBuffer.isView(obj[key])
      ) {
        result.push(...serialize(obj[key], fullPath, path.concat([key])))
      } else {
        result.push([fullPath, obj[key]])
      }
    })

    return result
  }

  // Determine encoding function
  let encodeFn = options?.encode ? encodeURIComponent : (val) => val

  let serializedParams: string
  if (options?.serialize) {
    serializedParams = options.serialize(params, options)
  } else if (params instanceof URLSearchParams) {
    serializedParams = params.toString()
  } else {
    const serializedArray = serialize(params).map(([key, value]) => [
      encodeFn(key),
      encodeFn(value),
    ])
    const qsOptions: Record<string, any> = {
      encode: false,
      indices: options?.indexes === true,
      allowDots: options?.dots === true,
    }
    serializedParams = qs.stringify(Object.fromEntries(serializedArray), qsOptions)
  }

  return `${url}?${serializedParams}`
}

const asyncNoError = async (promise: Promise<unknown>) => {
  try {
    await promise
  } catch {}
}

const settle = (resolve, reject, response: AxiosResponse) => {
  const {
    status,
    config: { validateStatus },
  } = response
  if (!status || !validateStatus || validateStatus(status)) {
    resolve(response)
  } else {
    reject(
      new AxiosError(
        `Request failed with status code ${status}`,
        [AxiosError.ERR_BAD_REQUEST, AxiosError.ERR_BAD_RESPONSE][
          Math.floor(response.status / 100) - 4
        ],
        response.config,
        response.request,
        response
      )
    )
  }
}

const adapter = async (
  name: string,
  connection: Connection,
  isExternalConnection: boolean,
  config: InternalAxiosRequestConfig
): AxiosPromise => {
  const requestId = uuidv4()
  log('Processing request id %s', requestId)
  const [requestQueue, responseQueue, uploadProgressQueue, downloadProgressQueue, cancelQueue] =
    await Promise.all([
      connection.getQueue(name, {
        type: 'confirm',
      }),
      connection.getQueue([name, requestId, 'response'].join('/'), {
        maxLength: 1,
      }),
      connection.getQueue([name, requestId, 'upload-progress'].join('/')),
      connection.getQueue([name, requestId, 'download-progress'].join('/')),
      connection.getQueue([name, requestId, 'cancel'].join('/')),
    ])
  uploadProgressQueue.listen(onAxiosProgressEventMessage.bind(null, config.onUploadProgress))
  downloadProgressQueue.listen(onAxiosProgressEventMessage.bind(null, config.onDownloadProgress))
  log('Listening for upload and download progress events for request %s', requestId)
  return new Promise(async function dispatchAmqplibOopRequest(resolve, reject) {
    const payload = {
      ...config,
      requestId,
      transformRequest: undefined,
      transformResponse: undefined,
      paramsSerializer: undefined,
      adapter: undefined,
      onUploadProgress: undefined,
      onDownloadProgress: undefined,
      validateStatus: undefined,
      beforeRedirect: undefined,
      httpAgent: undefined,
      httpsAgent: undefined,
      cancelToken: undefined,
      lookup: undefined,
    }
    const beforeCompletePromises: Array<Promise<unknown>> = []
    const cancellationPromise = new Promise((resolve) => {
      if (config.cancelToken) {
        config.cancelToken.promise.then((cancel) => {
          beforeCompletePromises.push(cancelQueue.enqueue(Buffer.from(Date.now().toString())))
          resolve(new CanceledError(cancel.message, AxiosError.ERR_CANCELED, config))
        })
      }
      if ('undefined' !== typeof config.signal) {
        if (config.signal.aborted) {
          beforeCompletePromises.push(cancelQueue.enqueue(Buffer.from(Date.now().toString())))
          resolve(new CanceledError('Request aborted', AxiosError.ERR_CANCELED, config))
        } else if ('function' === typeof config.signal.addEventListener) {
          config.signal.addEventListener('abort', () => {
            beforeCompletePromises.push(cancelQueue.enqueue(Buffer.from(Date.now().toString())))
            resolve(new CanceledError('Request aborted', AxiosError.ERR_CANCELED, config))
          })
        }
      }
    })
    const responsePromise = new Promise((resolve) => {
      responseQueue.listen(async (msg, ack, nack) => {
        const payload = msg.content
        let parsed: AxiosResponse | AxiosError | Error | undefined
        try {
          parsed = deserialize(payload)
          log('Received response for request %s: %o', requestId, parsed)
        } catch (e) {
          log('Failed to deserialize response for request %s: %o', requestId, e)
          nack(false)
          return resolve(new Error('Failed to deserialize response'))
        }
        ack()
        log('Acknowledged response for request %s', requestId)
        return resolve(parsed!)
      })
      log('Listening for response for request %s', requestId)
    })
    const operationPromise = new Promise(async (resolve) => {
      if ('stream' === config.responseType) {
        log('Failing with 406 for request %s due to unsupported response type "stream"', requestId)
        return resolve({
          status: 406,
          statusText: 'Response Type "stream" Not Supported',
          headers: {},
          config,
        })
      }
      if (config.beforeRedirect) {
        log(
          'Failing with 406 for request %s due to unsupported configuration option "beforeRedirect"',
          requestId
        )
        return resolve({
          status: 406,
          statusText:
            'Option "beforeRedirect" cannot be set on the client adapter and must be set on the amqplib-oop-axios server',
          headers: {},
          config,
        })
      }
      if (config.httpAgent) {
        log(
          'Failing with 406 for request %s due to unsupported configuration option "httpAgent"',
          requestId
        )
        return resolve({
          status: 406,
          statusText:
            'Option "httpAgent" cannot be set on the client adapter and must be set on the amqplib-oop-axios server',
          headers: {},
          config,
        })
      }
      if (config.httpsAgent) {
        log(
          'Failing with 406 for request %s due to unsupported configuration option "httpsAgent"',
          requestId
        )
        return resolve({
          status: 406,
          statusText:
            'Option "httpsAgent" cannot be set on the client adapter and must be set on the amqplib-oop-axios server',
          headers: {},
          config,
        })
      }
      if (config.lookup) {
        log(
          'Failing with 406 for request %s due to unsupported configuration option "lookup"',
          requestId
        )
        return resolve({
          status: 406,
          statusText:
            'Option "lookup" cannot be set on the client adapter and must be set on the amqplib-oop-axios server',
          headers: {},
          config,
        })
      }
      if ('undefined' !== typeof config.paramsSerializer) {
        log('Serializing URL for request %s', requestId)
        payload.url = buildUrlWithParams(payload.url, payload.params, config.paramsSerializer)
        payload.params = undefined
      }
      if (config.signal?.aborted) {
        log('Request cancelled for request %s', requestId)
        beforeCompletePromises.push(cancelQueue.enqueue(Buffer.from(Date.now().toString())))
        return resolve(new CanceledError('Request aborted', AxiosError.ERR_CANCELED, config))
      }
      log('Sending request %s: %o', requestId, payload)
      await requestQueue.enqueue(Buffer.from(JSON.stringify(payload)), {
        correlationId: requestId,
      })
      if (config.signal?.aborted) {
        log('Request cancelled for request %s', requestId)
        beforeCompletePromises.push(cancelQueue.enqueue(Buffer.from(Date.now().toString())))
        return resolve(new CanceledError('Request aborted', AxiosError.ERR_CANCELED, config))
      }
      log('Waiting for response for request %s', requestId)
      const res = await responsePromise
      log('Received response for request %s: %o', requestId, res)
      return resolve(res)
    })
    log(
      'Waiting for all promises which need to be resolved before completion for request %s',
      requestId
    )
    await Promise.all(beforeCompletePromises)
    log('Waiting for response or cancellation for request %s', requestId)
    const response = (await Promise.race([cancellationPromise, operationPromise])) as
      | AxiosResponse
      | AxiosError
      | Error
    log('Received response or cancellation for request %s: %o', requestId, response)
    log('Waiting for handling of confirmations & processing of RPCs for request %s', requestId)
    await Promise.all([
      asyncNoError(requestQueue.awaitHandlingOfConfirmations(500)),
      asyncNoError(responseQueue.awaitHandlingOfConfirmations(500)),
      asyncNoError(uploadProgressQueue.awaitHandlingOfConfirmations(500)),
      asyncNoError(downloadProgressQueue.awaitHandlingOfConfirmations(500)),
      asyncNoError(cancelQueue.awaitHandlingOfConfirmations(500)),
      asyncNoError(requestQueue.awaitProcessingOfRPCs(500)),
      asyncNoError(responseQueue.awaitProcessingOfRPCs(500)),
      asyncNoError(uploadProgressQueue.awaitProcessingOfRPCs(500)),
      asyncNoError(downloadProgressQueue.awaitProcessingOfRPCs(500)),
      asyncNoError(cancelQueue.awaitProcessingOfRPCs(500)),
    ])
    log('Pausing queues for request %s', requestId)
    await Promise.all([
      asyncNoError(requestQueue.pause(1000)),
      asyncNoError(responseQueue.pause(1000)),
      asyncNoError(uploadProgressQueue.pause(1000)),
      asyncNoError(downloadProgressQueue.pause(1000)),
      asyncNoError(cancelQueue.pause(1000)),
    ])
    log('Closing queues for request %s', requestId)
    await Promise.all([
      asyncNoError(responseQueue.delete()),
      asyncNoError(uploadProgressQueue.delete()),
      asyncNoError(downloadProgressQueue.delete()),
      asyncNoError(cancelQueue.delete()),
    ])
    if (!isExternalConnection) {
      log('Closing connection for request %s', requestId)
      await connection.close()
    }
    if (response instanceof Error) {
      return reject(response)
    }
    return settle(resolve, reject, response)
  })
}

/**
 * A class used to generate adapters for use with axios based on amqplib-oop
 *
 * @example
 *
 * ```typescript
 * import { AmqplibAxiosAdapterManager } from '@jakguru/amqplib-oop-axios'
 * ```
 *
 * or
 *
 * ```javascript
 * const { AmqplibAxiosAdapterManager } = require('@jakguru/amqplib-oop-axios')
 * ```
 *
 * ### Retreiving the Adapter
 *
 * In order to ensure that the script doesn't hang unexpectedly, if the adapter is initialized with [ConnectionConstructorOptions](https://jakguru.github.io/amqplib-oop/interfaces/ConnectionConstructorOptions.html), the connection will be closed once the request is complete and the adapter cannot be re-used. In order to create a reusable adapter instance, you should initialize the adapter with an already initialized [Connection](https://jakguru.github.io/amqplib-oop/classes/Connection.html) instance.
 *
 * **Note:** If you initialize the adapter with an already initialized [Connection](https://jakguru.github.io/amqplib-oop/classes/Connection.html) instance, you will need to manually close the connection when you are done with it.
 *
 * #### Using a single-use adapter with a single-use request
 *
 * ```typescript
 * axios({
 *   method: 'post',
 *   url: '/user/12345', // The full domain / URL is not needed because baseUrl is set on the worker
 *   data: {
 *     firstName: 'Fred',
 *     lastName: 'Flintstone'
 *   },
 *   adapter: AmqplibAxiosAdapterManager.make('example-queue', {
 *     // amqplib connection options
 *   })
 * }).then((response) => {
 *     // handle response normally
 * }).catch((error) => {
 *     // handle errors as you see fit
 * });
 * ```
 *
 * #### Creating a multi-use adapter
 *
 * ```typescript
 * import { Connection } from '@jakguru/amqplib-oop'
 * const connection = new Connection()
 * const adapter = AmqplibAxiosAdapterManager.make('example-queue', connection)
 * ```
 *
 * #### Using a multi-use adapter with a single-use request
 *
 * ```typescript
 * axios({
 *   method: 'post',
 *   url: '/user/12345', // The full domain / URL is not needed because baseUrl is set on the worker
 *   data: {
 *     firstName: 'Fred',
 *     lastName: 'Flintstone'
 *   },
 *   adapter,
 * }).then((response) => {
 *     // handle response normally
 * }).catch((error) => {
 *     // handle errors as you see fit
 * });
 * ```
 *
 * #### Using a multi-use adapter with a multi-use axios instance
 *
 * ```typescript
 * const instance = axios.create({
 *     adapter,
 * })
 *
 * instance({
 *   method: 'post',
 *   url: '/user/12345', // The full domain / URL is not needed because baseUrl is set on the worker
 *   data: {
 *     firstName: 'Fred',
 *     lastName: 'Flintstone'
 *   },
 * }).then((response) => {
 *     // handle response normally
 * }).catch((error) => {
 *     // handle errors as you see fit
 * });
 * ```
 */
export class AmqplibAxiosAdapterManager {
  readonly #name: string
  readonly #connection: Connection
  readonly #externalConnection: boolean
  #destroyed: boolean = false

  /**
   * Create a new adapter manager instance
   *
   * @param name Name of the queue through which requests will be sent
   * @param config The amqplib-oop connection options or an instance of a connection
   *
   * @note If a connection is passed in, it will not be closed when the adapter is closed
   */
  constructor(name: string, config: AmqplibAxiosAdapterManagerConfiguration) {
    this.#name = name
    if (config instanceof Connection) {
      this.#connection = config
      this.#externalConnection = true
    } else {
      this.#connection = new Connection(config)
      this.#connection.$on('close', () => {
        this.#destroyed = true
      })
      this.#externalConnection = false
    }
  }

  /**
   * The adapter function to be used with the Axios Request Config `adapter` property
   * @see https://axios-http.com/docs/req_config
   */
  public get adapter(): AxiosAdapter {
    if (this.#destroyed) {
      throw new Error('Connection has been closed. Please create a new adapter manager instance.')
    }
    const name = this.#name
    const connection = this.#connection
    const externalConnection = this.#externalConnection
    return adapter.bind(null, name, connection, externalConnection)
  }

  /**
   * Close the connection
   */
  public async close(): Promise<void> {
    await this.#connection.close()
  }

  /**
   * Generate an adapter function to be used with the Axios Request Config `adapter` property
   *
   * @param name Name of the queue through which requests will be sent
   * @param config The amqplib-oop connection options or an instance of a connection
   * @returns The adapter function to be used with the Axios Request Config `adapter` property
   *
   * @note If a connection is passed in, it will not be closed when the adapter is closed
   */
  public static make(name: string, config: AmqplibAxiosAdapterManagerConfiguration): AxiosAdapter {
    const adapterManager = new AmqplibAxiosAdapterManager(name, config)
    return adapterManager.adapter
  }
}
