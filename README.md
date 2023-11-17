# amqplib-oop-axios

Welcome to `amqplib-oop-axios`, an innovative library designed to revolutionize how axios requests are processed in a distributed system. Built upon the robust foundation of [`amqplib-oop-ratelimiter`](https://jakguru.github.io/amqplib-oop-ratelimiter), this library introduces a seamless integration between axios and AMQP brokers like RabbitMQ, facilitating a decoupled architecture where requests are sent from the requester to a remote worker for processing.

`amqplib-oop-axios` consists of a mechanism to generate either single-use or multi-use adapters for use with axios requests, coupled with a dedicated worker module. This powerful combination ensures that axios requests utilize the same API that you are comfortable with while benefiting from the remote processing capabilities. By leveraging an AMQP broker, `amqplib-oop-axios` not only optimizes request handling but also maintains the integrity and reliability of the communication process.

For more information, view the [documentation](https://jakguru.github.io/amqplib-oop-axios/index.html)

## Example Use Cases

* Rate Limit all requests across your various services to a specific API services
* Authenticate a request to a service without using [axios interceptors](https://axios-http.com/docs/interceptors) without exposing credentials to the requester
* Horizontally increase processing bandwidth for requests by utilizing a fleet of workers without impacting the core application
* Distribute a request workload between multiple workers while maintaining the promise chain

## Important Notes

* `stream` Response Types are not possible since there is no direct connection between the worker(s) and the requesting adapter
* The `beforeRedirect` property cannot be set on the requesting adapter, only the worker.
* The `httpAgent` property cannot be set on the requesting adapter, only the worker.
* The `httpsAgent` property cannot be set on the requesting adapter, only the worker.
* The `lookup` property cannot be set on the requesting adapter, only the worker.
* The requesting adapter and the worker maintain separate `transformRequest`, `transformResponse`, and `paramsSerializer` properties. Be careful not to run the same functionality twice or you may encounter some unexpected results.
* This library uses [v8.serialize](https://nodejs.org/api/v8.html#v8serializevalue) and [v8.deserialize](https://nodejs.org/api/v8.html#v8deserializebuffer) for serialization of responses and event information. If you are running different versions of NodeJS, this may not behave as expected.
* Defaults set on the reqesting axios instance override defaults set on the worker
* The request / response interceptors on the reqesting axios instance and on the worker are both run in the order:
  1. Requesting Axios Instance Request Interceptor
  2. Worker Instance Request Interceptor
  3. Worker Instance Response Interceptor
  4. Requesting Axios Instance Response Interceptor

## Installation

```bash
npm install @jakguru/amqplib-oop-axios
```

or

```bash
yarn add @jakguru/amqplib-oop-axios
```

## Worker Usage

### Import / Require the worker class

```typescript
import { AmqplibAxiosWorker } from '@jakguru/amqplib-oop-axios'
```

or

```javascript
const { AmqplibAxiosWorker } = require('@jakguru/amqplib-oop-axios')
```

### Setting up the worker

```typescript
const worker = new AmqplibAxiosWorker(
    'example-queue',
    {}, // amqplib connection options
    {
        interval: 1000, // 1 second in ms
        perInterval: 10, // 10 requests per interval
        autostart: true,
    },
    {
        baseURL: 'https://some-domain.com/api',
    }
)
// Optional: Update the axios defaults
worker.defaults.headers.common['Authorization'] = AUTH_TOKEN;

// Optional: Add interceptors
worker.interceptors.request.use(function (config) {
    // Do something before request is sent
    return config;
  }, function (error) {
    // Do something with request error
    return Promise.reject(error);
  });
```

## Adapter Usage

### Import / Require Adapter Manager

```typescript
import { AmqplibAxiosAdapterManager } from '@jakguru/amqplib-oop-axios'
```

or

```javascript
const { AmqplibAxiosAdapterManager } = require('@jakguru/amqplib-oop-axios')
```

### Retreiving the Adapter

In order to ensure that the script doesn't hang unexpectedly, if the adapter is initialized with [ConnectionConstructorOptions](https://jakguru.github.io/amqplib-oop/interfaces/ConnectionConstructorOptions.html), the connection will be closed once the request is complete and the adapter cannot be re-used. In order to create a reusable adapter instance, you should initialize the adapter with an already initialized [Connection](https://jakguru.github.io/amqplib-oop/classes/Connection.html) instance.

**Note:** If you initialize the adapter with an already initialized [Connection](https://jakguru.github.io/amqplib-oop/classes/Connection.html) instance, you will need to manually close the connection when you are done with it.

#### Using a single-use adapter with a single-use request

```typescript
axios({
  method: 'post',
  url: '/user/12345', // The full domain / URL is not needed because baseUrl is set on the worker
  data: {
    firstName: 'Fred',
    lastName: 'Flintstone'
  },
  adapter: AmqplibAxiosAdapterManager.make('example-queue', {
    // amqplib connection options
  })
}).then((response) => {
    // handle response normally
}).catch((error) => {
    // handle errors as you see fit
});
```

#### Creating a multi-use adapter

```typescript
import { Connection } from '@jakguru/amqplib-oop'
const connection = new Connection()
const adapter = AmqplibAxiosAdapterManager.make('example-queue', connection)
```

#### Using a multi-use adapter with a single-use request

```typescript
axios({
  method: 'post',
  url: '/user/12345', // The full domain / URL is not needed because baseUrl is set on the worker
  data: {
    firstName: 'Fred',
    lastName: 'Flintstone'
  },
  adapter,
}).then((response) => {
    // handle response normally
}).catch((error) => {
    // handle errors as you see fit
});
```

#### Using a multi-use adapter with a multi-use axios instance

```typescript
const instance = axios.create({
    adapter,
})

instance({
  method: 'post',
  url: '/user/12345', // The full domain / URL is not needed because baseUrl is set on the worker
  data: {
    firstName: 'Fred',
    lastName: 'Flintstone'
  },
}).then((response) => {
    // handle response normally
}).catch((error) => {
    // handle errors as you see fit
});
```

## How it Works

The following is a flowchart of how `amqplib-oop-axios` handles the flow of information.

```text
                                                                           ┌────────────┐
                                                                           │ Queue Name │
                                                                           └─────┬──────┘
                                                                                 │
                                                                                 │
                                                                                 │
        ┌───────────┐                                                            │
┌───────► Requester │                        ┌────────────────────────┐          │
│       └─────┬─────┘                        │ AMQP Broker Connection │          │
│             │                              └───────────┬────────────┘          │
│             │                                          │                       │
│     ┌───────▼────────┐                ┌────────────────▼──────────────────┐    │
│     │ Axios Instance │                │ amqplib-oop-axios Adapter Manager ◄────┴
│     └───────┬────────┘                └────────────────┬──────────────────┘
│             │                                          │
│             │                                          │
│      ┌──────▼─────────┐                   ┌────────────▼──────────────┐
│      │ Request Config ◄───────────────────┤ amqplib-oop-axios adapter │
│      └──────┬─────────┘                   │    for specific queue     │
│             │                             └───────────────────────────┘
│             │
│             │                                    ┌───────────────┐
│             │                       ┌────────────► Request Queue ├
│             │                       │            └───────────────┘
│         ┌───▼─────┐                 │
│         │         ├─────────────────┤     ┌───────────────────────────────┐
│         │ Request │                 └─────► Request Specific Cancel Queue ├
└─────────┤ Promise ◄──────┐                └───────────────────────────────┘
          │         │      │
          └─────────┘      │               ┌─────────────────────────────────┐
                           │   ┌───────────┤ Request Specific Response Queue │
                           │   │           └─────────────────────────────────┘
                           │   │
                           │   │        ┌────────────────────────────────────────┐
                           └───┼────────┤ Request Specific Upload Progress Queue ◄
                               │        └────────────────────────────────────────┘
                               │
                               │       ┌──────────────────────────────────────────┐
                               └───────┤ Request Specific Download Progress Queue ◄
                                       └──────────────────────────────────────────┘

                                    ┌────────────┐
                                    │ Queue Name │
                                    └─────┬──────┘
                                          │
                                          │
                                          │
                                          │
      ┌────────────────────────┐          │      ┌────────────────────────┐   ┌───────────────────┐
      │ AMQP Broker Connection │          │      │ AMQP Broker Connection │   │ Rate Limit Config │
      └───────────┬────────────┘          │      └───────────┬────────────┘   └─┬─────────────────┘
                  │                       │                  │                  │
 ┌────────────────▼──────────────────┐    │             ┌────▼──────────────────▼──┐   ┌──────────────┐
 │ amqplib-oop-axios Adapter Manager ◄────┴─────────────► amqplib-oop-axios Worker ◄───┤ Axios Config │
 └────────────────┬──────────────────┘                  └────────────┬──┬──────────┘   └──────────────┘
                  │                                                  │  │
                  │                                                  │  │
     ┌────────────▼──────────────┐                                   │  │
     ┤ amqplib-oop-axios adapter │                                   │  │
     │    for specific queue     │                                   │  │
     └───────────────────────────┘                                   │  └────────────────────┐
                                                                     │                       │
            ┌───────────────┐                             ┌──────────▼───────────┐   ┌───────▼────────┐
            ► Request Queue ├───────────────────┬─────────► Worker Job Processor │   │ Axios Instance │
            └───────────────┘                   │         └──────────┬───────────┘   └──▲─────────┬───┘
                                                │                    │                  │         │
     ┌───────────────────────────────┐          │                 ┌──▼──┐               │         │
     ► Request Specific Cancel Queue ├──────────┘                 │ Job ├───────────────┘         │
     └───────────────────────────────┘                            └─────┘                         │
                                                                                                  │
    ┌─────────────────────────────────┐                                                           │
    ┤ Request Specific Response Queue │◄───────────┐                                              │
    └─────────────────────────────────┘            │                                              │
                                                   │                                              │
 ┌────────────────────────────────────────┐        │                                              │
 ┤ Request Specific Upload Progress Queue ◄────────┼──────────────────────────────────────────────┘
 └────────────────────────────────────────┘        │
                                                   │
┌──────────────────────────────────────────┐       │
┤ Request Specific Download Progress Queue ◄───────┘
└──────────────────────────────────────────┘
```
