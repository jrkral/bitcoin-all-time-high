import config from 'config'
import { Observable } from 'rxjs'
import dissoc from 'ramda/src/dissoc'
import when from 'ramda/src/when'
import complement from 'ramda/src/complement'
import isEmpty from 'ramda/src/isEmpty'
import numeral from 'numeral'
import moment from 'moment'
import createStore from './store'

const isNotEmpty = complement(isEmpty)

export default async ({ dependencies: { db, log }, events } = {}) => {
  const store = createStore()
  const highs = await db.highs.find({})

  Observable.fromEvent(events, '*.ERROR').subscribe(err => log.error(err))

  Observable.fromEvent(events, 'gdax.TRADE')
    .filter(store.isAllTimeHigh)
    .subscribe(({ exchange, trade }) =>
      events.emit('core.NEW_HIGH', {
        exchange,
        price: trade.price,
        pair: trade.product_id,
        time: trade.time
      })
    )

  Observable.fromEvent(events, 'core.NEW_HIGH').subscribe(
    ({ price: high }) => (
      log.info('NEW ALL TIME HIGH!', store.getState().high, '->', high),
      store.dispatch({ type: 'SET_HIGH', high })
    )
  )

  Observable.fromEvent(events, 'core.NEW_HIGH')
    .debounceTime(config.get('debounce'))
    .subscribe(async ({ price: high, exchange, time }) => {
      log.debug(
        'core.NEW_HIGH:DEBOUNCED',
        JSON.stringify({ exchange, high, time })
      )

      db.highs.update({ exchange }, { $set: { high } }, { upsert: true })

      const text = numeral(high).format('$0,0')

      const data = {
        image: './images/bitcoin-clouds-1012x506.png',
        width: 1012,
        height: 506,
        font: 'images/Roboto-Bold.ttf',
        texts: [
          { text, size: 40, color: '#50b8ef', x: 240, y: 50 },
          { text, size: 40, color: '#50b8ef', x: 640, y: 290 },
          { text, size: 40, color: '#50b8ef', x: 560, y: 130 },
          { text, size: 40, color: '#2d97e5', x: 40, y: 40 },
          { text, size: 40, color: '#2d97e5', x: 400, y: 70 },
          { text, size: 40, color: '#2d97e5', x: 800, y: 130 },
          { text, size: 40, color: '#2d97e5', x: 300, y: 230 },
          { text, size: 120, color: '#ffffff', x: 400, y: 190 }
        ]
      }

      events.emit('media.CREATE', { exchange, high, time, data })
    })

  Observable.fromEvent(events, 'media.CREATE:DONE').subscribe(
    ({ exchange, high, time, image }) => {
      log.debug('media.CREATE:DONE', exchange, high, time)
      const date = moment(time)
      const dollarsAndCents = numeral(high).format('$0,0.00')
      const text = `🎉🎉 NEW ALL TIME HIGH 🎉🎉\n\n 1 Bitcoin = ${dollarsAndCents} USD\n\n ${date.format(
        'dddd, MMMM Do YYYY, h:mm:ss a'
      )} on ${exchange.toUpperCase()}`

      events.emit('twitter.POST_MEDIA', { exchange, high, time, image, text })
    }
  )

  Observable.fromEvent(events, 'twitter.POST_MEDIA:DONE').subscribe(data =>
    log.info('twitter.POST_MEDIA:DONE', JSON.stringify(dissoc('image', data)))
  )

  Observable.fromEvent(events, 'gdax.CLOSE').subscribe(() =>
    log.info('GDAX connection closed.')
  )

  when(
    isNotEmpty,
    () => store.dispatch({ type: 'SET_HIGH', high: highs[0].high }),
    highs
  )

  log.info('Previous all time high:', store.getState().high)
}
