require('dotenv').config()

const test = require('ava')
const request = require('supertest')
const express = require('express')
const bodyParser = require('body-parser')
const _ = require('lodash')

const userServer = express()
let userServerPort
const userServerCalls = {}
let userApp

const { before, beforeEach, after } = require('../../lifecycle')
const { getAccessTokenHeaders } = require('../../auth')

let userWebhookUrl

const defaultTestDelay = 4000

let createdWebhooks

/* eslint-disable no-template-curly-in-string */

async function createWebhookLogs (t) {
  if (createdWebhooks) return createdWebhooks

  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'webhookLog:list:all',
      'webhook:create:all',
      'category:create:all',
      'entry:create:all',
      'message:create:all',
    ]
  })

  // should create webhooks that listen to events that are not triggered by any tests below

  const { body: messageWebhook } = await request(t.context.serverUrl)
    .post('/webhooks')
    .set(authorizationHeaders)
    .send({
      name: 'Webhook for message creation',
      event: 'message__created',
      targetUrl: userWebhookUrl + 'messageCreation',
    })
    .expect(200)

  const { body: entryWebhook } = await request(t.context.serverUrl)
    .post('/webhooks')
    .set(authorizationHeaders)
    .send({
      name: 'Webhook for entry creation',
      event: 'entry__created',
      targetUrl: userWebhookUrl + 'entryCreation',
    })
    .expect(200)

  createdWebhooks = _.keyBy([
    messageWebhook,
    entryWebhook,
  ], 'event')

  await request(t.context.serverUrl)
    .post('/messages')
    .set(authorizationHeaders)
    .send({
      topicId: 'ast_2l7fQps1I3a1gJYz2I3a',
      receiverId: 'user-external-id',
      content: 'Good',
    })
    .expect(200)

  await request(t.context.serverUrl)
    .post('/entries')
    .set(authorizationHeaders)
    .send({
      collection: 'someCollection',
      locale: 'en-US',
      name: 'nameExample',
      fields: {
        title: 'Random title',
        content: 'Random content',
        nestedContent: {
          random1: {
            random2: 'hello'
          },
          random3: 'bye'
        }
      }
    })
    .expect(200)

  await new Promise(resolve => setTimeout(resolve, defaultTestDelay))
}

test.before(async (t) => {
  await before({ name: 'webhook' })(t)
  await beforeEach()(t)

  userServer.use(bodyParser.json())
  userServer.post('/error', function (req, res) {
    res.status(500).json({ message: 'Webhook target server error' })
  })
  userServer.post('*', function (req, res) {
    const webhookName = req.path.replace('/', '')

    if (!Array.isArray(userServerCalls[webhookName])) userServerCalls[webhookName] = []
    userServerCalls[webhookName].unshift(req.body)

    res.json({ ok: true })
  })

  await new Promise((resolve, reject) => {
    userApp = userServer.listen((err) => {
      if (err) return reject(err)

      // dynamically get a free port
      userServerPort = userApp.address().port

      userWebhookUrl = `http://localhost:${userServerPort}/`

      resolve()
    })
  })

  await createWebhookLogs(t)
})
// test.beforeEach(beforeEach()) // concurrent tests are much faster
test.after(async (t) => {
  await after()(t)
  await userApp.close()
})

test('list webhook logs', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['webhookLog:list:all'] })

  const { body: obj } = await request(t.context.serverUrl)
    .get('/webhook-logs?page=2')
    .set(authorizationHeaders)
    .expect(200)

  t.true(typeof obj === 'object')
  t.true(typeof obj.nbResults === 'number')
  t.true(typeof obj.nbPages === 'number')
  t.true(typeof obj.page === 'number')
  t.true(typeof obj.nbResultsPerPage === 'number')
  t.true(Array.isArray(obj.results))
})

test('list webhook logs with id filter', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['webhookLog:list:all'] })

  const { body: { results: webhookLogs } } = await request(t.context.serverUrl)
    .get('/webhook-logs')
    .set(authorizationHeaders)
    .expect(200)

  const webhookLog = webhookLogs[0]

  const { body: obj } = await request(t.context.serverUrl)
    .get(`/webhook-logs?id=${webhookLog.id}`)
    .set(authorizationHeaders)
    .expect(200)

  t.is(typeof obj, 'object')
  t.is(obj.nbResults, 1)
  t.is(obj.nbPages, 1)
  t.is(obj.page, 1)
  t.is(typeof obj.nbResultsPerPage, 'number')
  t.is(obj.results.length, 1)
})

test('list webhook logs with advanced filters', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({ t, permissions: ['webhookLog:list:all'] })

  const minDate = '2019-01-01T00:00:00.000Z'

  const {
    entry__created: entryWorkflow,
    message__created: messageWorkflow,
  } = createdWebhooks

  const params = `createdDate[gte]=${encodeURIComponent(minDate)}` +
    `&webhookId[]=${entryWorkflow.id}` +
    `&webhookId[]=${messageWorkflow.id}`

  const { body: obj } = await request(t.context.serverUrl)
    .get(`/webhook-logs?${params}`)
    .set(authorizationHeaders)
    .expect(200)

  t.is(obj.results.length, obj.nbResults)
  obj.results.forEach(webhookLog => {
    t.true(webhookLog.createdDate >= minDate)
    t.true([entryWorkflow.id, messageWorkflow.id].includes(webhookLog.webhookId))
  })

  const { body: obj2 } = await request(t.context.serverUrl)
    .get('/webhook-logs?status=success')
    .set(authorizationHeaders)
    .expect(200)

  t.is(obj2.results.length, obj2.nbResults)
  obj2.results.forEach(webhookLog => {
    t.is(webhookLog.status, 'success')
  })
})

test('finds a webhook log', async (t) => {
  const authorizationHeaders = await getAccessTokenHeaders({
    t,
    permissions: [
      'webhookLog:list:all',
      'webhookLog:read:all'
    ]
  })

  const { body: { results: webhookLogs } } = await request(t.context.serverUrl)
    .get('/webhook-logs')
    .set(authorizationHeaders)
    .expect(200)

  const { body: webhookLog } = await request(t.context.serverUrl)
    .get(`/webhook-logs/${webhookLogs[0].id}`)
    .set(authorizationHeaders)
    .expect(200)

  t.is(webhookLog.id, webhookLogs[0].id)
})
