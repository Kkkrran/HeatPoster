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
  },

  lifetimes: {
    attached() {
      this.loadBackgrounds()
    },
  },

  methods: {
    async loadBackgrounds() {
      this.setData({ loading: true })
      
      const basePath = 'cloud://art-9g2yt6t89a45335b.6172-art-9g2yt6t89a45335b-1393918820/backgrounds/'
      const backgrounds: BackgroundItem[] = []

      // 尝试加载 bg1 到 bg10
      const loadPromises = []
      for (let i = 1; i <= 10; i++) {
        const fileID = `${basePath}bg${i}.png`
        loadPromises.push(
          this.tryLoadBackground(fileID, `bg${i}`)
            .then(item => {
              if (item) {
                backgrounds.push(item)
              }
            })
            .catch(() => {
              // 忽略不存在的文件
            })
        )
      }

      await Promise.all(loadPromises)
      
      // 按名称排序
      backgrounds.sort((a, b) => {
        const numA = parseInt(a.name.replace('bg', ''))
        const numB = parseInt(b.name.replace('bg', ''))
        return numA - numB
      })

      this.setData({ backgrounds, loading: false })
    },

    async tryLoadBackground(fileID: string, name: string): Promise<BackgroundItem | null> {
      try {
        const downloadRes = await wx.cloud.downloadFile({ fileID })
        
        // 获取图片信息以计算宽高比
        let aspectRatio: number | undefined
        try {
          const imageInfo = await new Promise<WechatMiniprogram.GetImageInfoSuccessCallbackResult>((resolve, reject) => {
            wx.getImageInfo({
              src: downloadRes.tempFilePath,
              success: resolve,
              fail: reject,
            })
          })
          aspectRatio = imageInfo.width / imageInfo.height
        } catch (err) {
          console.warn('获取图片信息失败', err)
          // 如果获取图片信息失败，使用默认宽高比或留空
        }
        
        return {
          name,
          fileID,
          tempFilePath: downloadRes.tempFilePath,
          aspectRatio,
        }
      } catch (err) {
        // 文件不存在，返回 null
        return null
      }
    },

    onSelectBg(e: any) {
      const index = e.currentTarget.dataset.index
      const bg = this.data.backgrounds[index]
      if (!bg) return

      // 保存选择的背景到本地存储
      wx.setStorageSync('selected_background', {
        name: bg.name,
        fileID: bg.fileID,
        tempFilePath: bg.tempFilePath,
        aspectRatio: bg.aspectRatio, // 保存宽高比
      })

      // 显示选择成功的提示
      wx.showToast({
        title: `已选择 ${bg.name}`,
        icon: 'success',
        duration: 1500, // 稍微延长显示时间，让用户看到提示
      })

      // 延迟一点时间后自动返回设置页面
      setTimeout(() => {
        wx.navigateBack({
          delta: 1,
          success: () => {
            // 返回成功后，settings页面会通过pageLifetimes.show()自动刷新
          }
        })
      }, 1500)
    },

    onSelectNoBg() {
      // 清除常驻背景
      wx.removeStorageSync('selected_background')

      // 显示选择成功的提示
      wx.showToast({
        title: '已选择无背景',
        icon: 'success',
        duration: 1500,
      })

      // 延迟一点时间后自动返回设置页面
      setTimeout(() => {
        wx.navigateBack({
          delta: 1,
          success: () => {
            // 返回成功后，settings页面会通过pageLifetimes.show()自动刷新
          }
        })
      }, 1500)
    },
  },
})

