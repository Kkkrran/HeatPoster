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

      // 1. 加载本地背景 bglocal.png
      try {
        const localBgPath = '/images/bglocal.png'
        const imageInfo = await new Promise<WechatMiniprogram.GetImageInfoSuccessCallbackResult>((resolve, reject) => {
          wx.getImageInfo({
            src: localBgPath,
            success: resolve,
            fail: reject,
          })
        })
        backgrounds.push({
          name: '默认背景',
          fileID: '', // 本地文件无 cloud ID
          tempFilePath: localBgPath,
          aspectRatio: imageInfo.width / imageInfo.height,
        })
      } catch (err) {
        console.error('加载本地背景失败', err)
      }

      // 如果当前没有选中的背景，默认使用第一个（bglocal.png）如果不为空
       const currentBg = wx.getStorageSync('selected_background')
       if (!currentBg && backgrounds.length > 0) {
           const bg = backgrounds[0]
           wx.setStorageSync('selected_background', {
                name: bg.name,
                fileID: bg.fileID,
                tempFilePath: bg.tempFilePath,
                aspectRatio: bg.aspectRatio, // 保存宽高比
            })
       }

      // 2. 尝试加载云端背景 bg1 到 bg10
      const cloudBackgrounds: BackgroundItem[] = []
      const loadPromises = []
      for (let i = 1; i <= 10; i++) {
        const fileID = `${basePath}bg${i}.png`
        loadPromises.push(
          this.tryLoadBackground(fileID, `bg${i}`)
            .then(item => {
              if (item) {
                cloudBackgrounds.push(item)
              }
            })
            .catch(() => {
              // 忽略不存在的文件
            })
        )
      }

      await Promise.all(loadPromises)
      
      // 按名称排序云端背景
      cloudBackgrounds.sort((a, b) => {
        const numA = parseInt(a.name.replace('bg', ''))
        const numB = parseInt(b.name.replace('bg', ''))
        return numA - numB
      })
      
      // 合并本地背景和云端背景
      this.setData({ backgrounds: backgrounds.concat(cloudBackgrounds), loading: false })
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
    },
  },
})

