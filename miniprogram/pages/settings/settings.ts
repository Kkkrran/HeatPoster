Component({
  data: {
    exitConfirm: true,
  },

  lifetimes: {
    attached() {
      const exitConfirm = wx.getStorageSync('editor_exit_confirm') || true
      this.setData({ exitConfirm })
    }
  },

  methods: {
    onExitConfirmChange(e: any) {
      const val = e.detail.value
      this.setData({ exitConfirm: val })
      wx.setStorageSync('editor_exit_confirm', val)
    },

    onRequestAlbumAuth() {
      wx.authorize({
        scope: 'scope.writePhotosAlbum',
        success: () => {
          wx.showToast({ title: '授权成功', icon: 'success' })
        },
        fail: () => {
          wx.showToast({ title: '未授权，可去设置开启', icon: 'none' })
        },
      })
    },

    onOpenSetting() {
      wx.openSetting({})
    },

    onClearCache() {
      wx.showToast({ title: '清理缓存（占位）', icon: 'none' })
    },

    onBackHome() {
      wx.navigateBack({ delta: 1 })
    },
  },
})
