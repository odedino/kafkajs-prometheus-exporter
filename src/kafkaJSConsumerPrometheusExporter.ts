import type { ConnectEvent, Consumer, ConsumerCrashEvent, ConsumerEndBatchProcessEvent, ConsumerFetchEvent, ConsumerHeartbeatEvent, DisconnectEvent, RequestEvent, RequestQueueSizeEvent } from 'kafkajs'
import { Counter, Gauge, Histogram, type Registry } from 'prom-client'

import { type KafkaJSConsumerExporterOptions } from './kafkaJSConsumerExporterOptions'
import { mergeLabelNamesWithStandardLabels, mergeLabelsWithStandardLabels } from './utils'

/**
 * Exports metrics for a Kafka consumer
 */
export class KafkaJSConsumerPrometheusExporter {
  private readonly consumer: Consumer
  private readonly register: Registry
  private readonly options: KafkaJSConsumerExporterOptions
  private readonly defaultOptions: KafkaJSConsumerExporterOptions = {
    consumerRequestDurationHistogramBuckets: [0.001, 0.005, 0.010, 0.020, 0.030, 0.040, 0.050, 0.100, 0.200, 0.500, 1.0, 2.0, 5.0, 10],
    consumerBatchLatencyHistogramBuckets: [0.001, 0.005, 0.010, 0.020, 0.030, 0.040, 0.050, 0.100, 0.200, 0.500, 1.0, 2.0, 5.0, 10],
    consumerBatchDurationHistogramBuckets: [0.001, 0.005, 0.010, 0.020, 0.030, 0.040, 0.050, 0.100, 0.200, 0.500, 1.0, 2.0, 5.0, 10],
    consumerFetchLatencyHistogramBuckets: [0.001, 0.005, 0.010, 0.020, 0.030, 0.040, 0.050, 0.100, 0.200, 0.500, 1.0, 2.0, 5.0, 10],
    consumerFetchDurationHistogramBuckets: [0.001, 0.005, 0.010, 0.020, 0.030, 0.040, 0.050, 0.100, 0.200, 0.500, 1.0, 2.0, 5.0, 10]
  }

  private readonly consumerActiveConnections: Gauge
  private readonly consumerConnectionsCreatedTotal: Counter
  private readonly consumerConnectionsClosedTotal: Counter
  private readonly consumerConnectionsCrashedTotal: Counter
  private readonly consumerHeartbeats: Counter
  private readonly consumerRequestQueueSize: Gauge
  private readonly consumerFetchLatency: Histogram
  private readonly consumerFetchDuration: Histogram
  private readonly consumerFetchTotal: Counter
  private readonly consumerBatchSizeTotal: Counter
  private readonly consumerBatchLatency: Histogram
  private readonly consumerBatchDuration: Histogram
  private readonly consumerRequestTotal: Counter
  private readonly consumerRequestSizeTotal: Counter
  private readonly consumerRequestDuration: Histogram

  constructor (consumer: Consumer, register: Registry, options?: KafkaJSConsumerExporterOptions) {
    this.consumer = consumer
    this.register = register
    this.options = { ...this.defaultOptions, ...options }

    this.consumerActiveConnections = new Gauge({
      name: 'kafka_consumer_connection_count',
      help: 'The current number of active connections established with a broker',
      labelNames: mergeLabelNamesWithStandardLabels([], this.options.defaultLabels),
      registers: [this.register]
    })

    this.consumerConnectionsCreatedTotal = new Counter({
      name: 'kafka_consumer_connection_creation_total',
      help: 'The total number of connections established with a broker',
      labelNames: mergeLabelNamesWithStandardLabels([], this.options.defaultLabels),
      registers: [this.register]
    })

    this.consumerConnectionsClosedTotal = new Counter({
      name: 'kafka_consumer_connection_close_total',
      help: 'The total number of connections closed with a broker',
      labelNames: mergeLabelNamesWithStandardLabels([], this.options.defaultLabels),
      registers: [this.register]
    })

    this.consumerConnectionsCrashedTotal = new Counter({
      name: 'kafka_consumer_connection_crashed_total',
      help: 'The total number of crashed connections with a broker',
      labelNames: mergeLabelNamesWithStandardLabels(['group_id', 'error', 'restart'], this.options.defaultLabels),
      registers: [this.register]
    })

    this.consumerHeartbeats = new Counter({
      name: 'kafka_consumer_heartbeat_total',
      help: 'The total number of heartbeats with a broker',
      labelNames: mergeLabelNamesWithStandardLabels(['group_id', 'member_id'], this.options.defaultLabels),
      registers: [this.register]
    })

    this.consumerRequestTotal = new Counter({
      name: 'kafka_consumer_request_total',
      help: 'The total number of requests sent.',
      labelNames: mergeLabelNamesWithStandardLabels(['broker'], this.options.defaultLabels),
      registers: [this.register]
    })

    this.consumerRequestSizeTotal = new Gauge({
      name: 'kafka_consumer_request_size_total',
      help: 'The size of any request sent.',
      labelNames: mergeLabelNamesWithStandardLabels(['broker'], this.options.defaultLabels),
      registers: [this.register]
    })

    this.consumerRequestQueueSize = new Gauge({
      name: 'kafka_consumer_request_queue_size',
      help: 'Size of the request queue.',
      labelNames: mergeLabelNamesWithStandardLabels(['broker'], this.options.defaultLabels),
      registers: [this.register]
    })

    this.consumerFetchLatency = new Histogram({
      name: 'kafka_consumer_fetch_latency',
      help: 'The time taken for a fetch request.',
      labelNames: mergeLabelNamesWithStandardLabels([], this.options.defaultLabels),
      buckets: this.options.consumerFetchLatencyHistogramBuckets,
      registers: [this.register]
    })

    this.consumerFetchDuration = new Histogram({
      name: 'kafka_consumer_fetch_duration_seconds',
      help: 'The time taken for a fetch request.',
      labelNames: mergeLabelNamesWithStandardLabels([], this.options.defaultLabels),
      buckets: this.options.consumerFetchDurationHistogramBuckets,
      registers: [this.register]
    })

    this.consumerFetchTotal = new Counter({
      name: 'kafka_consumer_fetch_total',
      help: 'The total number of fetch requests.',
      labelNames: mergeLabelNamesWithStandardLabels([], this.options.defaultLabels),
      registers: [this.register]
    })

    this.consumerBatchSizeTotal = new Counter({
      name: 'kafka_consumer_batch_size_total',
      help: 'The number of bytes received per partition per request',
      labelNames: mergeLabelNamesWithStandardLabels(['topic', 'partition'], this.options.defaultLabels),
      registers: [this.register]
    })

    this.consumerBatchLatency = new Histogram({
      name: 'kafka_consumer_batch_latency',
      help: 'The time taken for processing a batch.',
      labelNames: mergeLabelNamesWithStandardLabels(['topic', 'partition'], this.options.defaultLabels),
      buckets: this.options.consumerBatchLatencyHistogramBuckets,
      registers: [this.register]
    })

    this.consumerBatchDuration = new Histogram({
      name: 'kafka_consumer_batch_duration_seconds',
      help: 'The time taken for processing a batch.',
      labelNames: mergeLabelNamesWithStandardLabels(['topic', 'partition'], this.options.defaultLabels),
      buckets: this.options.consumerBatchDurationHistogramBuckets,
      registers: [this.register]
    })

    this.consumerRequestDuration = new Histogram({
      name: 'kafka_consumer_request_duration_seconds',
      help: 'The time taken for processing a consumer request.',
      labelNames: mergeLabelNamesWithStandardLabels(['broker'], this.options.defaultLabels),
      buckets: this.options.consumerRequestDurationHistogramBuckets,
      registers: [this.register]
    })
  }

  public enableMetrics (): void {
    this.consumer.on('consumer.connect', event => { this.onConsumerConnect(event) })
    this.consumer.on('consumer.disconnect', event => { this.onConsumerDisconnect(event) })
    this.consumer.on('consumer.crash', event => { this.onConsumerCrashed(event) })
    this.consumer.on('consumer.heartbeat', event => { this.onConsumerHeartbeat(event) })
    this.consumer.on('consumer.network.request', event => { this.onConsumerRequest(event) })
    this.consumer.on('consumer.network.request_queue_size', event => { this.onConsumerRequestQueueSize(event) })
    this.consumer.on('consumer.fetch', event => { this.onConsumerFetch(event) })
    this.consumer.on('consumer.end_batch_process', event => { this.onConsumerEndBatch(event) })
  }

  onConsumerConnect (event: ConnectEvent): void {
    this.consumerActiveConnections.inc(mergeLabelsWithStandardLabels({}, this.options.defaultLabels))
    this.consumerConnectionsCreatedTotal.inc(mergeLabelsWithStandardLabels({}, this.options.defaultLabels))
  }

  onConsumerDisconnect (event: DisconnectEvent): void {
    this.consumerActiveConnections.dec(mergeLabelsWithStandardLabels({}, this.options.defaultLabels))
    this.consumerConnectionsClosedTotal.inc(mergeLabelsWithStandardLabels({}, this.options.defaultLabels))
  }

  onConsumerCrashed (event: ConsumerCrashEvent): void {
    this.consumerConnectionsCrashedTotal.inc(mergeLabelsWithStandardLabels({ group_id: event.payload.groupId, error: event.payload.error.name, restart: event.payload.restart.valueOf().toString() }, this.options.defaultLabels))
  }

  onConsumerHeartbeat (event: ConsumerHeartbeatEvent): void {
    this.consumerHeartbeats.inc(mergeLabelsWithStandardLabels({ group_id: event.payload.groupId, member_id: event.payload.memberId }, this.options.defaultLabels))
  }

  onConsumerRequest (event: RequestEvent): void {
    this.consumerRequestTotal.inc(mergeLabelsWithStandardLabels({ broker: event.payload.broker }, this.options.defaultLabels))
    this.consumerRequestSizeTotal.inc(mergeLabelsWithStandardLabels({ broker: event.payload.broker }, this.options.defaultLabels), event.payload.size)
    this.consumerRequestDuration.observe(mergeLabelsWithStandardLabels({ broker: event.payload.broker }, this.options.defaultLabels), event.payload.duration / 1000)
  }

  onConsumerRequestQueueSize (event: RequestQueueSizeEvent): void {
    this.consumerRequestQueueSize.set(mergeLabelsWithStandardLabels({ broker: event.payload.broker }, this.options.defaultLabels), event.payload.queueSize)
  }

  onConsumerFetch (event: ConsumerFetchEvent): void {
    this.consumerFetchDuration.observe(mergeLabelsWithStandardLabels({}, this.options.defaultLabels), event.payload.duration / 1000)
    this.consumerFetchLatency.observe(mergeLabelsWithStandardLabels({}, this.options.defaultLabels), event.payload.duration / 1000)
    this.consumerFetchTotal.inc(mergeLabelsWithStandardLabels({}, this.options.defaultLabels))
  }

  onConsumerEndBatch (event: ConsumerEndBatchProcessEvent): void {
    this.consumerBatchSizeTotal.inc(mergeLabelsWithStandardLabels({ topic: event.payload.topic, partition: event.payload.partition }, this.options.defaultLabels), event.payload.batchSize)
    this.consumerBatchDuration.observe(mergeLabelsWithStandardLabels({ topic: event.payload.topic, partition: event.payload.partition }, this.options.defaultLabels), event.payload.duration / 1000)
    this.consumerBatchLatency.observe(mergeLabelsWithStandardLabels({ topic: event.payload.topic, partition: event.payload.partition }, this.options.defaultLabels), event.payload.duration / 1000)
  }
}
