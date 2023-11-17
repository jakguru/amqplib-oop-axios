import { RateLimitedQueueClient } from '@jakguru/amqplib-oop-ratelimiter'
import type {
  RateLimitedQueueConnectionConfiguration,
  RateLimitedQueueConfig,
} from '@jakguru/amqplib-oop-ratelimiter'
import type { ConnectionConstructorOptions } from '@jakguru/amqplib-oop'
import type {
  Axios,
  CreateAxiosDefaults,
  InternalAxiosRequestConfig,
  AxiosInterceptorManager,
  AxiosResponse,
} from 'axios'
import { Connection } from '@jakguru/amqplib-oop'
import axios from 'axios'
import { serialize } from 'v8'
const debug = require('debug')

const log = debug('amqplib-oop-axios:worker')

/**
 * Configuration options for the AmqplibAxiosWorker.
 */
export type AmqplibAxiosWorkerQueueConfig = Omit<RateLimitedQueueConfig, 'spillMethod'>

/**
 * Configuration options for the connection and queue used by the AmqplibAxiosWorker.
 */
export type AmpqlibAxiosWorkerQueueConnectionConfiguration = RateLimitedQueueConnectionConfiguration

/**
 * The AxiosInterceptorManagers for the worker's axios instance.
 * @see https://axios-http.com/docs/interceptors
 */
export interface AxiosInterceptorManagers {
  /**
   * The interceptors manager for the worker's axios instance's request interceptors.
   */
  request: AxiosInterceptorManager<InternalAxiosRequestConfig<any>>
  /**
   * The interceptors manager for the worker's axios instance's response interceptors.
   */
  response: AxiosInterceptorManager<AxiosResponse<any, any>>
}

type CleanInternalAxiosRequestConfig = Omit<
  InternalAxiosRequestConfig,
  | 'transformRequest'
  | 'transformResponse'
  | 'paramsSerializer'
  | 'adapter'
  | 'onUploadProgress'
  | 'onDownloadProgress'
  | 'validateStatus'
  | 'beforeRedirect'
  | 'httpAgent'
  | 'httpsAgent'
  | 'cancelToken'
  | 'lookup'
>

type AmqplibAxiosWorkerInternalAxiosRequestConfig = CleanInternalAxiosRequestConfig & {
  requestId: string
}

const asyncNoError = async (promise: Promise<unknown>) => {
  try {
    await promise
  } catch {}
}

function cleanNonSerializable(obj, seen = new Set()) {
  if (
    typeof obj === 'function' ||
    typeof obj === 'symbol' ||
    obj instanceof WeakMap ||
    obj instanceof WeakSet ||
    obj instanceof Promise ||
    obj instanceof Map ||
    obj instanceof Set
  ) {
    return undefined
  }
  if (typeof obj === 'object' && obj !== null) {
    if (seen.has(obj)) {
      return undefined
    }
    seen.add(obj)
    for (let key in obj) {
      try {
        obj[key] = cleanNonSerializable(obj[key], seen)
        if (obj[key] === undefined) {
          delete obj[key]
        }
      } catch (error) {
        // Ignore errors when trying to assign a new value to a read-only property
        continue
      }
    }
  }
  return obj
}

/**
 * A customized implementation of the RateLimitedQueueClient that uses axios to make requests and returns the responses via amqplib.
 * Works with the {@link AmqplibAxiosAdapterManager.adapter | amqplib-oop-axios Adapter}.
 *
 * @example
 *
 *
 * ```typescript
 * import { AmqplibAxiosWorker } from '@jakguru/amqplib-oop-axios'
 *
 * const worker = new AmqplibAxiosWorker(
 *     'example-queue',
 *     {}, // amqplib connection options
 *     {
 *         interval: 1000, // 1 second in ms
 *         perInterval: 10, // 10 requests per interval
 *         autostart: true,
 *     },
 *     {
 *         baseURL: 'https://some-domain.com/api',
 *     }
 * )
 * // Optional: Update the axios defaults
 * worker.defaults.headers.common['Authorization'] = AUTH_TOKEN;
 *
 * // Optional: Add interceptors
 * worker.interceptors.request.use(function (config) {
 *     // Do something before request is sent
 *     return config;
 *   }, function (error) {
 *     // Do something with request error
 *     return Promise.reject(error);
 *   });
 * ```
 */
export class AmqplibAxiosWorker {
  readonly #name: string
  readonly #client: RateLimitedQueueClient
  readonly #axios: Axios
  readonly #connection: Connection
  readonly #isExternalConnection: boolean
  readonly #config: Partial<RateLimitedQueueConfig>
  readonly #defaults: CreateAxiosDefaults

  /**
   * Creates a new instance of a AmqplibAxiosWorker.
   * @param name The name of the queue from which requests will be consumed from.
   * @param connection The amqplib-oop connection options or an instance of a connection.
   * @param config The rate limiter configuration options.
   * @param defaults The default axios configuration options.
   */
  constructor(
    name: string,
    connection: AmpqlibAxiosWorkerQueueConnectionConfiguration,
    config: Partial<AmqplibAxiosWorkerQueueConfig>,
    defaults?: CreateAxiosDefaults
  ) {
    this.#name = name
    this.#connection =
      connection.connection instanceof Connection
        ? connection.connection
        : new Connection(connection.connection as Partial<ConnectionConstructorOptions>)
    this.#isExternalConnection = connection instanceof Connection
    this.#config = {
      ...config,
      spillMethod: 'drop',
    }
    this.#defaults = defaults || {}
    this.#axios = axios.create(this.#defaults)
    this.#client = new RateLimitedQueueClient<AmqplibAxiosWorkerInternalAxiosRequestConfig>(
      this.#name,
      {
        ...connection,
        connection: this.#connection,
      },
      async (items) => {
        const item = items[0]
        const abortController = new AbortController()
        const { requestId } = item
        log('Processing request %s', requestId)
        const cnfg: InternalAxiosRequestConfig = {
          ...item,
          requestId: undefined,
        } as CleanInternalAxiosRequestConfig as InternalAxiosRequestConfig
        const [responseQueue, uploadProgressQueue, downloadProgressQueue, cancelQueue] =
          await Promise.all([
            this.#connection.getQueue([this.#name, requestId, 'response'].join('/'), {
              maxLength: 1,
            }),
            this.#connection.getQueue([this.#name, requestId, 'upload-progress'].join('/')),
            this.#connection.getQueue([this.#name, requestId, 'download-progress'].join('/')),
            this.#connection.getQueue([this.#name, requestId, 'cancel'].join('/')),
          ])
        cancelQueue.listen((_msg, ack) => {
          log('Received cancel for request %s', requestId)
          abortController.abort()
          ack()
        })
        const beforeCompletePromises: Array<Promise<unknown>> = []
        cnfg.onUploadProgress = (progressEvent) => {
          uploadProgressQueue.enqueue(serialize(progressEvent))
        }
        cnfg.onDownloadProgress = (progressEvent) => {
          downloadProgressQueue.enqueue(serialize(progressEvent))
        }
        cnfg.signal = abortController.signal
        cnfg.validateStatus = () => true
        try {
          log('Sending request %s', requestId)
          const response = await this.#axios.request(cnfg)
          delete response.request
          log('Received response for request %s, %o', requestId, response)
          beforeCompletePromises.push(
            responseQueue.enqueue(serialize(cleanNonSerializable(response)))
          )
        } catch (caught) {
          log('Caught error for request %s, %o', requestId, caught)
          if (caught.response) {
            delete caught.response.request
          }
          beforeCompletePromises.push(
            responseQueue.enqueue(serialize(cleanNonSerializable(caught)))
          )
        }
        log('Awaiting all promises which need to run before completion for request %s', requestId)
        await Promise.all(beforeCompletePromises)
        log('Awaiting all confirmations and processing for request %s', requestId)
        await Promise.all([
          asyncNoError(responseQueue.awaitHandlingOfConfirmations(10000)),
          asyncNoError(uploadProgressQueue.awaitHandlingOfConfirmations(10000)),
          asyncNoError(downloadProgressQueue.awaitHandlingOfConfirmations(10000)),
          asyncNoError(cancelQueue.awaitHandlingOfConfirmations(10000)),
          asyncNoError(responseQueue.awaitProcessingOfRPCs(10000)),
          asyncNoError(uploadProgressQueue.awaitProcessingOfRPCs(10000)),
          asyncNoError(downloadProgressQueue.awaitProcessingOfRPCs(10000)),
          asyncNoError(cancelQueue.awaitProcessingOfRPCs(10000)),
        ])
        log('Pausing all queues for request %s', requestId)
        await Promise.all([
          asyncNoError(responseQueue.pause(10000)),
          asyncNoError(uploadProgressQueue.pause(10000)),
          asyncNoError(downloadProgressQueue.pause(10000)),
          asyncNoError(cancelQueue.pause(10000)),
        ])
        log('Finished processing request %s', requestId)
      },
      this.#config
    )
    log('Created worker for queue %s', this.#name)
  }

  /**
   * Returns a boolean indicating whether or not the queue is running.
   * @returns A boolean indicating whether or not the queue is running.
   */
  public get running() {
    return this.#client.running
  }

  /**
   * Returns a boolean indicating whether or not the queue is currently processing a tick.
   * @returns A boolean indicating whether or not the queue is currently processing a tick.
   */
  public get working() {
    return this.#client.working
  }

  /**
   * Returns a boolean indicating whether or not the queue has been shut down.
   * @returns A boolean indicating whether or not the queue has been shut down.
   */
  public get isShutDown() {
    return this.#client.isShutDown
  }

  /**
   * The configuration defaults for the worker's axios instance.
   * @see https://axios-http.com/docs/config_defaults
   */
  public get defaults() {
    return this.#axios.defaults
  }

  /**
   * The interceptors manager for the worker's axios instance
   * @see https://axios-http.com/docs/interceptors
   * @returns The interceptors manager for the worker's axios instance
   */
  public get interceptors(): AxiosInterceptorManagers {
    return this.#axios.interceptors
  }

  /**
   * Gets the total number of jobs in the queue (waiting + active).
   * @returns A Promise that resolves to the total number of jobs in the queue.
   */
  public async getPressure() {
    return await this.#client.getPressure()
  }

  /**
   * Shuts down the queue.
   * @returns A Promise that resolves when the queue has shut down.
   * @remarks This will stop the queue and close the Connection connection.
   */
  public async shutdown() {
    const promise = await this.#client.shutdown()
    if (!this.#isExternalConnection) {
      await this.#connection.close()
    }
    return promise
  }

  /**
   * Starts processing the queue.
   * If the queue is already running, it will wait for the current tick to complete before starting a new one.
   * @returns A Promise that resolves when the queue has started.
   */
  public async start() {
    return await this.#client.start()
  }

  /**
   * Stops processing the queue.
   * If the queue is currently working, it will wait for the current tick to complete before stopping.
   * @returns A Promise that resolves when the queue has stopped.
   */
  public async stop() {
    return await this.#client.stop()
  }
}
