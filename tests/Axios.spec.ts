import { test } from '@japa/runner'
import { AmqplibAxiosWorker, AmqplibAxiosAdapterManager, AmqpAxiosProxiedClient } from '../'
import { Connection } from '@jakguru/amqplib-oop'
import type { ConnectionConstructorOptions } from '@jakguru/amqplib-oop'
import axios from 'axios'

const asyncNoError = async (promise: Promise<unknown>) => {
  try {
    await promise
  } catch {}
}

test.group('axios', (group) => {
  const options: Partial<ConnectionConstructorOptions> = {
    protocol: process.env.PROTOCOL,
    hostname: process.env.HOSTNAME,
    port: process.env.PORT ? parseInt(process.env.PORT) : undefined,
    username: process.env.USERNAME,
    password: process.env.PASSWORD,
    locale: process.env.LOCALE,
    frameMax: process.env.FRAMEMAX ? parseInt(process.env.FRAMEMAX) : undefined,
    heartbeat: process.env.HEARTBEAT ? parseInt(process.env.HEARTBEAT) : undefined,
    vhost: process.env.VHOST,
  }
  let persistentConnection: Connection | undefined
  let persistentWorker: AmqplibAxiosWorker | undefined
  let persistentAdapterManager: AmqplibAxiosAdapterManager | undefined
  let testConnection: Connection | undefined
  let testWorker: AmqplibAxiosWorker | undefined
  let testAdapterManager: AmqplibAxiosAdapterManager | undefined
  group.setup(async () => {
    console.log('Setting up test group connections')
    persistentConnection = new Connection(options)
    persistentWorker = new AmqplibAxiosWorker(
      'test',
      {
        connection: persistentConnection,
      },
      {
        interval: 1000,
        perInterval: 10,
        autostart: false,
      },
      {
        baseURL: 'https://httpbin.org',
      }
    )
    persistentAdapterManager = new AmqplibAxiosAdapterManager('test', persistentConnection)
    console.log('Test group connections ready')
  })
  group.teardown(async () => {
    console.log('Tearing down test group connections')
    if (persistentWorker) {
      await asyncNoError(persistentWorker.shutdown())
    }
    if (persistentConnection) {
      await asyncNoError(persistentConnection.close())
    }
    if (persistentAdapterManager) {
      await asyncNoError(persistentAdapterManager.close())
    }
    if (testWorker) {
      await asyncNoError(testWorker.shutdown())
    }
    if (testConnection) {
      await asyncNoError(testConnection.close())
    }
    if (testAdapterManager) {
      await asyncNoError(testAdapterManager.close())
    }
    console.log('Tore down test group connections')
  })
  group.each.teardown(async () => {
    console.log('Tearing down test connections')
    if (testWorker) {
      await asyncNoError(testWorker.shutdown())
      testWorker = undefined
    }
    if (testConnection) {
      await asyncNoError(testConnection.close())
      testConnection = undefined
    }
    if (testAdapterManager) {
      await asyncNoError(testAdapterManager.close())
      testAdapterManager = undefined
    }
    console.log('Tore down test connections')
  })

  test('persistant worker is working', async ({ assert }) => {
    assert.instanceOf(persistentConnection, Connection)
    assert.instanceOf(persistentWorker, AmqplibAxiosWorker)
    await persistentWorker!.start()
    await persistentWorker!.stop()
  })

  test('can setup a worker', async ({ assert }) => {
    testWorker = new AmqplibAxiosWorker(
      'test',
      { connection: options },
      {
        interval: 1000,
        perInterval: 10,
        autostart: false,
      }
    )
    assert.instanceOf(testWorker, AmqplibAxiosWorker)
    await testWorker!.start()
    await testWorker!.stop()
  })
  test('can setup an adapter manager', async ({ assert }) => {
    assert.instanceOf(persistentAdapterManager, AmqplibAxiosAdapterManager)
    testAdapterManager = new AmqplibAxiosAdapterManager('test', options)
    assert.instanceOf(testAdapterManager, AmqplibAxiosAdapterManager)
  })
  test('can make requests and get responses', async ({ assert }) => {
    assert.instanceOf(persistentAdapterManager, AmqplibAxiosAdapterManager)
    assert.instanceOf(persistentWorker, AmqplibAxiosWorker)
    await persistentWorker!.start()
    const instance = axios.create({
      adapter: persistentAdapterManager!.adapter,
    })
    const getResponse = await instance.get('/get')
    assert.equal(getResponse.status, 200)
    console.log(getResponse)
    const postResponse = await instance.post('/post', { data: 'test' })
    assert.equal(postResponse.status, 200)
    console.log(postResponse)
    const putResponse = await instance.put('/put', { data: 'test' })
    assert.equal(putResponse.status, 200)
    console.log(putResponse)
    const patchResponse = await instance.patch('/patch', { data: 'test' })
    assert.equal(patchResponse.status, 200)
    console.log(patchResponse)
    await persistentWorker!.stop()
  }).timeout(59999)

  test('can make requests and get responses via client', async ({ assert }) => {
    assert.instanceOf(persistentWorker, AmqplibAxiosWorker)
    assert.instanceOf(persistentConnection, Connection)
    await persistentWorker!.start()
    const instance = new AmqpAxiosProxiedClient('test', persistentConnection!)
    const getResponse = await instance.get('/get')
    assert.equal(getResponse.status, 200)
    console.log(getResponse)
    const postResponse = await instance.post('/post', { data: 'test' })
    assert.equal(postResponse.status, 200)
    console.log(postResponse)
    const putResponse = await instance.put('/put', { data: 'test' })
    assert.equal(putResponse.status, 200)
    console.log(putResponse)
    const patchResponse = await instance.patch('/patch', { data: 'test' })
    assert.equal(patchResponse.status, 200)
    console.log(patchResponse)
    await persistentWorker!.stop()
  }).timeout(59999)
})
