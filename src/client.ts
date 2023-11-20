import { AmqplibAxiosAdapterManager } from './adapter'
import type { AmqplibAxiosAdapterManagerConfiguration } from './adapter'
import axios from 'axios'
import type { Axios, AxiosResponse, AxiosRequestConfig, AxiosDefaults } from 'axios'

/**
 * Represents a request configuration for a client that uses AMQP as a transport layer.
 * It removes all the properties that are not supported by the adapter.
 */
export type AmqpAxiosProxiedClientConfig<D = any> = Omit<
  AxiosRequestConfig<D>,
  | 'transformRequest'
  | 'transformResponse'
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

/**
 * An instance of axios which is preconfigured to use the AMQP adapter.
 */
export class AmqpAxiosProxiedClient implements Axios {
  readonly #queueName: string
  readonly #connection: AmqplibAxiosAdapterManagerConfiguration
  readonly #adapterManager: AmqplibAxiosAdapterManager
  readonly #axios: Axios

  /**
   * Creates an instance of AmqpAxiosProxiedClient.
   * @param queueName The name of the queue which will be used to send requests to the worker.
   * @param connection The amqplib-oop connection options or an instance of a connection
   * @param config The default configuration which you want to provide to the axios instance.
   */
  constructor(
    queueName: string,
    connection: AmqplibAxiosAdapterManagerConfiguration,
    config: AmqpAxiosProxiedClientConfig = {}
  ) {
    this.#queueName = queueName
    this.#connection = connection
    this.#adapterManager = new AmqplibAxiosAdapterManager(this.#queueName, this.#connection)
    this.#axios = axios.create({
      ...config,
      adapter: this.#adapterManager.adapter,
    })
  }

  /**
   * Configuration defaults which can be applied to every request.
   * @see https://axios-http.com/docs/config_defaults
   */
  public get defaults(): AxiosDefaults {
    return this.#axios.defaults
  }

  /**
   * Hooks which allow the modification of requests before they are sent to the server,
   * and responses before they are returned to the caller.
   */
  public get interceptors(): {
    request: Axios['interceptors']['request']
    response: Axios['interceptors']['response']
  } {
    return this.#axios.interceptors
  }

  /**
   * Resolve the url for the request based on the config.
   * @param config The configuration for the request
   * @returns The url for the request
   */
  public getUri(config?: AxiosRequestConfig): string {
    return this.#axios.getUri(config)
  }

  /**
   * @typeParam T the type defining the shape of the response payload
   * @typeParam R the type defining the shape of the full axios response
   * @typeParam D the type defining the shape of the request payload
   * Make a with the method & url specified in the config.
   * @param config The configuration for the request
   * @returns The response for the request
   * @throws {AxiosError} If the request fails
   */
  public async request<T = any, R = AxiosResponse<T>, D = any>(
    config: AmqpAxiosProxiedClientConfig<D>
  ): Promise<R> {
    return await this.#axios.request<T, R, D>(config)
  }

  /**
   * Make an HTTP GET request to the specified URL.
   * @typeParam T the type defining the shape of the response payload
   * @typeParam R the type defining the shape of the full axios response
   * @typeParam D the type defining the shape of the request payload
   * @param url The url for the request
   * @param config The configuration for the request
   * @returns The response for the request
   * @throws {AxiosError} If the request fails
   */
  public async get<T = any, R = AxiosResponse<T>, D = any>(
    url: string,
    config?: AmqpAxiosProxiedClientConfig<D>
  ): Promise<R> {
    return await this.#axios.get<T, R, D>(url, config)
  }

  /**
   * Make an HTTP DELETE request to the specified URL.
   * @typeParam T the type defining the shape of the response payload
   * @typeParam R the type defining the shape of the full axios response
   * @typeParam D the type defining the shape of the request payload
   * @param url The url for the request
   * @param config The configuration for the request
   * @returns The response for the request
   * @throws {AxiosError} If the request fails
   */
  public async delete<T = any, R = AxiosResponse<T>, D = any>(
    url: string,
    config?: AmqpAxiosProxiedClientConfig<D>
  ): Promise<R> {
    return await this.#axios.delete<T, R, D>(url, config)
  }

  /**
   * Make an HTTP HEAD request to the specified URL.
   * @typeParam T the type defining the shape of the response payload
   * @typeParam R the type defining the shape of the full axios response
   * @typeParam D the type defining the shape of the request payload
   * @param url The url for the request
   * @param config The configuration for the request
   * @returns The response for the request
   * @throws {AxiosError} If the request fails
   */
  public async head<T = any, R = AxiosResponse<T>, D = any>(
    url: string,
    config?: AmqpAxiosProxiedClientConfig<D>
  ): Promise<R> {
    return await this.#axios.head<T, R, D>(url, config)
  }

  /**
   * Make an HTTP OPTIONS request to the specified URL.
   * @typeParam T the type defining the shape of the response payload
   * @typeParam R the type defining the shape of the full axios response
   * @typeParam D the type defining the shape of the request payload
   * @param url The url for the request
   * @param config The configuration for the request
   * @returns The response for the request
   * @throws {AxiosError} If the request fails
   */
  public async options<T = any, R = AxiosResponse<T>, D = any>(
    url: string,
    config?: AmqpAxiosProxiedClientConfig<D>
  ): Promise<R> {
    return await this.#axios.options<T, R, D>(url, config)
  }

  /**
   * Make an HTTP POST request to the specified URL with the specified payload
   * @typeParam T the type defining the shape of the response payload
   * @typeParam R the type defining the shape of the full axios response
   * @typeParam D the type defining the shape of the request payload
   * @param url The url for the request
   * @param config The configuration for the request
   * @returns The response for the request
   * @throws {AxiosError} If the request fails
   */
  public async post<T = any, R = AxiosResponse<T>, D = any>(
    url: string,
    data?: any,
    config?: AmqpAxiosProxiedClientConfig<D>
  ): Promise<R> {
    return await this.#axios.post<T, R, D>(url, data, config)
  }

  /**
   * Make an HTTP PUT request to the specified URL with the specified payload
   * @typeParam T the type defining the shape of the response payload
   * @typeParam R the type defining the shape of the full axios response
   * @typeParam D the type defining the shape of the request payload
   * @param url The url for the request
   * @param config The configuration for the request
   * @returns The response for the request
   * @throws {AxiosError} If the request fails
   */
  public async put<T = any, R = AxiosResponse<T>, D = any>(
    url: string,
    data?: any,
    config?: AmqpAxiosProxiedClientConfig<D>
  ): Promise<R> {
    return await this.#axios.put<T, R, D>(url, data, config)
  }

  /**
   * Make an HTTP PATCH request to the specified URL with the specified payload
   * @typeParam T the type defining the shape of the response payload
   * @typeParam R the type defining the shape of the full axios response
   * @typeParam D the type defining the shape of the request payload
   * @param url The url for the request
   * @param config The configuration for the request
   * @returns The response for the request
   * @throws {AxiosError} If the request fails
   */
  public async patch<T = any, R = AxiosResponse<T>, D = any>(
    url: string,
    data?: any,
    config?: AmqpAxiosProxiedClientConfig<D>
  ): Promise<R> {
    return await this.#axios.patch<T, R, D>(url, data, config)
  }

  /**
   * Make an HTTP POST request with the content-type set to `application/x-www-form-urlencoded` to the specified URL with the specified payload
   * @typeParam T the type defining the shape of the response payload
   * @typeParam R the type defining the shape of the full axios response
   * @typeParam D the type defining the shape of the request payload
   * @param url The url for the request
   * @param config The configuration for the request
   * @returns The response for the request
   * @throws {AxiosError} If the request fails
   */
  public async postForm<T = any, R = AxiosResponse<T>, D = any>(
    url: string,
    data?: any,
    config?: AmqpAxiosProxiedClientConfig<D>
  ): Promise<R> {
    return await this.#axios.postForm<T, R, D>(url, data, config)
  }

  /**
   * Make an HTTP PUT request with the content-type set to `application/x-www-form-urlencoded` to the specified URL with the specified payload
   * @typeParam T the type defining the shape of the response payload
   * @typeParam R the type defining the shape of the full axios response
   * @typeParam D the type defining the shape of the request payload
   * @param url The url for the request
   * @param config The configuration for the request
   * @returns The response for the request
   * @throws {AxiosError} If the request fails
   */
  public async putForm<T = any, R = AxiosResponse<T>, D = any>(
    url: string,
    data?: any,
    config?: AmqpAxiosProxiedClientConfig<D>
  ): Promise<R> {
    return await this.#axios.putForm<T, R, D>(url, data, config)
  }

  /**
   * Make an HTTP PATCH request with the content-type set to `application/x-www-form-urlencoded` to the specified URL with the specified payload
   * @typeParam T the type defining the shape of the response payload
   * @typeParam R the type defining the shape of the full axios response
   * @typeParam D the type defining the shape of the request payload
   * @param url The url for the request
   * @param config The configuration for the request
   * @returns The response for the request
   * @throws {AxiosError} If the request fails
   */
  public async patchForm<T = any, R = AxiosResponse<T>, D = any>(
    url: string,
    data?: any,
    config?: AmqpAxiosProxiedClientConfig<D>
  ): Promise<R> {
    return await this.#axios.patchForm<T, R, D>(url, data, config)
  }
}
