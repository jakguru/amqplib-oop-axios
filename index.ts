/*
 *                                                                            ┌────────────┐
 *                                                                            │ Queue Name │
 *                                                                            └─────┬──────┘
 *                                                                                  │
 *                                                                                  │
 *                                                                                  │
 *         ┌───────────┐                                                            │
 * ┌───────► Requester │                        ┌────────────────────────┐          │      ┌────────────────────────┐   ┌───────────────────┐
 * │       └─────┬─────┘                        │ AMQP Broker Connection │          │      │ AMQP Broker Connection │   │ Rate Limit Config │
 * │             │                              └───────────┬────────────┘          │      └───────────┬────────────┘   └─┬─────────────────┘
 * │             │                                          │                       │                  │                  │
 * │     ┌───────▼────────┐                ┌────────────────▼──────────────────┐    │             ┌────▼──────────────────▼──┐   ┌──────────────────────┐
 * │     │ Axios Instance │                │ amqplib-oop-axios Adapter Manager ◄────┴─────────────► amqplib-oop-axios Worker ◄───┤ Axios Default Config │
 * │     └───────┬────────┘                └────────────────┬──────────────────┘                  └────────────┬──┬──────────┘   └──────────────────────┘
 * │             │                                          │                                                  │  │
 * │             │                                          │                                                  │  │
 * │      ┌──────▼─────────┐                   ┌────────────▼──────────────┐                                   │  │
 * │      │ Request Config ◄───────────────────┤ amqplib-oop-axios adapter │                                   │  │
 * │      └──────┬─────────┘                   │    for specific queue     │                                   │  │
 * │             │                             └───────────────────────────┘                                   │  └────────────────────┐
 * │             │                                                                                             │                       │
 * │             │                                    ┌───────────────┐                             ┌──────────▼───────────┐   ┌───────▼────────┐
 * │             │                       ┌────────────► Request Queue ├───────────────────┬─────────► Worker Job Processor │   │ Axios Instance │
 * │             │                       │            └───────────────┘                   │         └──────────┬───────────┘   └──▲─────────┬───┘
 * │         ┌───▼─────┐                 │                                                │                    │                  │         │
 * │         │         ├─────────────────┤     ┌───────────────────────────────┐          │                 ┌──▼──┐               │         │
 * │         │ Request │                 └─────► Request Specific Cancel Queue ├──────────┘                 │ Job ├───────────────┘         │
 * └─────────┤ Promise ◄──────┐                └───────────────────────────────┘                            └─────┘                         │
 *           │         │      │                                                                                                             │
 *           └─────────┘      │               ┌─────────────────────────────────┐                                                           │
 *                            │   ┌───────────┤ Request Specific Response Queue │◄───────────┐                                              │
 *                            │   │           └─────────────────────────────────┘            │                                              │
 *                            │   │                                                          │                                              │
 *                            │   │        ┌────────────────────────────────────────┐        │                                              │
 *                            └───┼────────┤ Request Specific Upload Progress Queue ◄────────┼──────────────────────────────────────────────┘
 *                                │        └────────────────────────────────────────┘        │
 *                                │                                                          │
 *                                │       ┌──────────────────────────────────────────┐       │
 *                                └───────┤ Request Specific Download Progress Queue ◄───────┘
 *                                        └──────────────────────────────────────────┘
 */

import type { AmqplibAxiosAdapterManagerConfiguration } from './src/adapter'
import type {
  AmqplibAxiosWorkerQueueConfig,
  AmpqlibAxiosWorkerQueueConnectionConfiguration,
  AxiosInterceptorManagers,
} from './src/worker'
import { AmqplibAxiosAdapterManager } from './src/adapter'
import { AmqplibAxiosWorker } from './src/worker'

export {
  AmqplibAxiosAdapterManager,
  AmqplibAxiosWorker,
  AmqplibAxiosAdapterManagerConfiguration,
  AmqplibAxiosWorkerQueueConfig,
  AmpqlibAxiosWorkerQueueConnectionConfiguration,
  AxiosInterceptorManagers,
}
export default {
  AmqplibAxiosAdapterManager,
  AmqplibAxiosWorker,
}
