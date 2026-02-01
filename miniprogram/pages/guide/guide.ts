// miniprogram/pages/guide/guide.ts
Page({
  onShow() {
    // 保持屏幕常亮
    wx.setKeepScreenOn({
      keepScreenOn: true
    })
  },
  goToEditor() {
    wx.redirectTo({
      url: '/pages/editor/editor'
    })
  },
  goToBrush() {
    wx.redirectTo({
      url: '/pages/brush/brush'
    })
  },
  goToAlbum() {
    wx.navigateTo({
      url: '/pages/album/album'
    })
  },
  goToSettings() {
    wx.navigateTo({
      url: '/pages/settings/settings'
    })
  }
})