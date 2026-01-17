// miniprogram/pages/guide/guide.ts
Page({
  goToEditor() {
    wx.navigateTo({
      url: '/pages/editor/editor'
    })
  },
  goToBrush() {
    wx.navigateTo({
      url: '/pages/brush/brush'
    })
  },
  goToAlbum() {
    wx.navigateTo({
      url: '/pages/album/album'
    })
  }
})