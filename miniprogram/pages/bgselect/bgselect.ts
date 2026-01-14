// pages/bgselect/bgselect.ts
type BackgroundItem = {
  name: string
  fileID: string
  tempFilePath: string
  aspectRatio?: number // 宽高比 (width / height)
}

Component({
  data: {
    backgrounds: [] as BackgroundItem[],
    loading: false,
    target: 'editor', // 'editor' or 'brush'
  },

  lifetimes: {
    attached() {
      // Moved to onLoad
    },
  },

  methods: {
    onLoad(options: any) {
      if (options && options.target) {
        this.setData({ target: options.target })
      }
      this.loadBackgrounds()
    },

    async loadBackgrounds() {
      this.setData({ loading: true })
      
      const backgrounds: BackgroundItem[] = []
      
      // 确定存储键名
      const target = (this as any).data.target
      
      // 1. 加载目标背景 (位于本地 /images/ 目录)
      const fileNameBase = target === 'brush' ? 'bgbrush' : 'bgeditor'
      const extensions = ['.png', '.jpg', '.jpeg']

      for (const ext of extensions) {
        const name = `${fileNameBase}${ext}`
        const path = `/images/${name}`

        try {
            const imageInfo = await this.getImageInfo(path)
            backgrounds.push({
                name: name,
                fileID: '',
                tempFilePath: path,
                aspectRatio: imageInfo.width / imageInfo.height
            })
        } catch (e) {
            // Ignore if file doesn't exist
        }
      }
      
      this.setData({ backgrounds: backgrounds, loading: false })

      // 如果当前没有选中的背景，且有可用背景，则默认选中第一个
      const storageKey = target === 'brush' ? 'selected_background_brush' : 'selected_background_editor'
      const currentBg = wx.getStorageSync(storageKey)
      if (!currentBg && backgrounds.length > 0) {
           const bg = backgrounds[0]
           wx.setStorageSync(storageKey, {
                name: bg.name,
                fileID: bg.fileID,
                tempFilePath: bg.tempFilePath,
                aspectRatio: bg.aspectRatio, // 保存宽高比
            })
       }
    },

    getImageInfo(path: string): Promise<WechatMiniprogram.GetImageInfoSuccessCallbackResult> {
        return new Promise((resolve, reject) => {
          wx.getImageInfo({
            src: path,
            success: resolve,
            fail: reject,
          })
        })
    },

    onSelectBg(e: any) {
      const index = e.currentTarget.dataset.index
      const bg = this.data.backgrounds[index]
      if (!bg) return

      const target = (this as any).data.target
      const storageKey = target === 'brush' ? 'selected_background_brush' : 'selected_background_editor'

      // 保存选择的背景到本地存储
      wx.setStorageSync(storageKey, {
        name: bg.name,
        fileID: bg.fileID,
        tempFilePath: bg.tempFilePath,
        aspectRatio: bg.aspectRatio, // 保存宽高比
      })
      
      // Also save to 'selected_background' for compatibility if needed, but avoiding conflict logic
      // wx.setStorageSync('selected_background', ...) // Removed to separate control

      // 显示选择成功的提示
      wx.showToast({
        title: `已选择 ${bg.name}`,
        icon: 'success',
        duration: 1500, // 稍微延长显示时间，让用户看到提示
      })
    },

    onSelectNoBg() {
      const target = (this as any).data.target
      const storageKey = target === 'brush' ? 'selected_background_brush' : 'selected_background_editor'

      // 清除常驻背景，这将导致恢复可能存在的默认背景 (bgeditor/bgbrush)
      wx.removeStorageSync(storageKey)

      // 重新触发加载逻辑，确保缓存被重置为默认背景(如果存在)
      this.loadBackgrounds()

      // 显示选择成功的提示
      wx.showToast({
        title: '已重置',
        icon: 'success',
        duration: 1500,
      })
    },
  },
})

