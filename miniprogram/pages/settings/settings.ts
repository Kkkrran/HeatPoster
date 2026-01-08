Component({
  data: {
    exitConfirm: false,
    maxUndoSteps: 10,
    limitDialogVisible: false,
    tempLimitValue: '',
    cloudImageUrl: '', // 云存储图片的临时路径
  },

  lifetimes: {
    attached() {
      let exitConfirm = wx.getStorageSync('editor_exit_confirm')
      if (exitConfirm === '') exitConfirm = true // 默认为开启
      
      const maxUndoSteps = wx.getStorageSync('editor_max_undo_steps') || 10
      this.setData({ exitConfirm, maxUndoSteps })
    }
  },

  methods: {
    onExitConfirmChange(e: any) {
      const val = e.detail.value
      this.setData({ exitConfirm: val })
      wx.setStorageSync('editor_exit_confirm', val)
    },

    onEditUndoLimit() {
      this.setData({
        limitDialogVisible: true,
        tempLimitValue: String(this.data.maxUndoSteps)
      })
    },

    onLimitInputChange(e: any) {
      this.setData({ tempLimitValue: e.detail.value })
    },

    onLimitCancel() {
      this.setData({ limitDialogVisible: false })
    },

    onLimitConfirm() {
      const val = parseInt(this.data.tempLimitValue, 10)
      if (isNaN(val) || val < 5 || val > 20) {
        wx.showToast({ title: '请输入5-20之间的整数', icon: 'none' })
        return
      }
      this.setData({ 
        maxUndoSteps: val,
        limitDialogVisible: false
      })
      wx.setStorageSync('editor_max_undo_steps', val)
      wx.showToast({ title: '设置成功', icon: 'success' })
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
      wx.showModal({
        title: '清理缓存',
        content: '确定要删除所有本地临时文件吗？此操作不可撤销。',
        success: (res) => {
          if (res.confirm) {
            const fs = wx.getFileSystemManager()
            try {
              // 删除 USER_DATA_PATH 下的文件
              // 由于 USER_DATA_PATH 是一个目录，我们列出所有文件并逐个删除
              // 注意：为了简单起见，这里假设 USER_DATA_PATH 下全是我们的临时文件
              // 更安全的方式是只删除特定前缀或后缀的文件，或者只删 artworks/ 目录（如果我们将内容组织在里面的话）
              // 这里我们采取稍微安全一点的策略：删除以 'tmp_' 开头的文件或者 .png, .json 文件
              // 但考虑到 `editor.ts` 里写文件用的是 `${wx.env.USER_DATA_PATH}/${Date.now()}_points.json`
              // 它们都在根下。
              
              const userDataPath = wx.env.USER_DATA_PATH
              const files = fs.readdirSync(userDataPath)
              
              let count = 0
              files.forEach(file => {
                if (file.endsWith('.json') || file.endsWith('.png') || file.endsWith('.jpg')) {
                   try {
                     fs.unlinkSync(`${userDataPath}/${file}`)
                     count++
                   } catch(e) { /* ignore */ }
                }
              })
              
              wx.showToast({ title: `已清理 ${count} 个文件`, icon: 'success' })
            } catch (err) {
              console.error(err)
              wx.showToast({ title: '清理失败', icon: 'error' })
            }
          }
        }
      })
    },

    onBackHome() {
      wx.navigateBack({ delta: 1 })
    },

    async onLoadCloudImage() {
      const fileID = 'cloud://cloud1-8gonkf4q94e7505c.636c-cloud1-8gonkf4q94e7505c-1393918820/backgrounds/bg1.png'
      
      try {
        wx.showLoading({ title: '读取中...' })
        const downloadRes = await wx.cloud.downloadFile({ fileID })
        this.setData({ cloudImageUrl: downloadRes.tempFilePath })
        wx.hideLoading()
        wx.showToast({ title: '读取成功', icon: 'success' })
      } catch (err: any) {
        console.error('读取云存储失败', err)
        wx.hideLoading()
        wx.showToast({ title: '读取失败', icon: 'none' })
      }
    },

    onGoBgSelect() {
      wx.navigateTo({ url: '/pages/bgselect/bgselect' })
    },
  },
})
