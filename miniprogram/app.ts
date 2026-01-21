// app.ts
App<IAppOption>({
  globalData: {},
  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({
        env: 'art-9g2yt6t89a45335b',
        traceUser: true,
      })
    }

    // 展示本地存储能力
    const logs = wx.getStorageSync('logs') || []
    logs.unshift(Date.now())
    wx.setStorageSync('logs', logs)

    // 日志文件操作已移除，避免文件系统错误

    // 登录
    wx.login({
      success: res => {
        console.log(res.code)
        // 发送 res.code 到后台换取 openId, sessionKey, unionId
      },
    })

    // 全局保持屏幕常亮
    wx.setKeepScreenOn({
      keepScreenOn: true
    })

    if (wx.onBackgroundFetchData) {
      wx.onBackgroundFetchData(() => {})
    }
  },
})
