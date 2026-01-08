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

    const fs = wx.getFileSystemManager()
    const root = wx.env.USER_DATA_PATH
    const logDir = `${root}/miniprogramLog`
    try { fs.accessSync(logDir) } catch { try { fs.mkdirSync(logDir, true) } catch (_) {} }
    const log2 = `${logDir}/log2`
    try { fs.accessSync(log2) } catch { try { fs.writeFileSync(log2, '', 'utf8') } catch (_) {} }

    // 登录
    wx.login({
      success: res => {
        console.log(res.code)
        // 发送 res.code 到后台换取 openId, sessionKey, unionId
      },
    })

    if (wx.onBackgroundFetchData) {
      wx.onBackgroundFetchData(() => {})
    }
  },
})
