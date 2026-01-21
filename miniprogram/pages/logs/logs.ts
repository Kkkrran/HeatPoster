// logs.ts
// const util = require('../../utils/util.js')
import { formatTime } from '../../utils/util'

Component({
  data: {
    logs: [],
  },
  lifetimes: {
    attached() {
      this.setData({
        logs: (wx.getStorageSync('logs') || []).map((log: string) => {
          return {
            date: formatTime(new Date(log)),
            timeStamp: log
          }
        }),
      })
    }
  },

  pageLifetimes: {
    show() {
      // 保持屏幕常亮
      wx.setKeepScreenOn({
        keepScreenOn: true
      })
    }
  },
})
