// pages/album/album.ts
type ArtworkItem = {
  id: string
  _openid: string
  createdAt: number
  fileID: string
  tempFilePath: string
  aspectRatio?: number
}

Component({
  data: {
    artworks: [] as ArtworkItem[],
    loading: false,
  },

  lifetimes: {
    attached() {
      this.loadArtworks()
    },
  },

  methods: {
    async loadArtworks() {
      if (!wx.cloud) {
        wx.showToast({ title: '未检测到云开发能力', icon: 'none' })
        return
      }

      this.setData({ loading: true })

      try {
        // 使用云函数获取所有作品（绕过小程序端权限限制）
        const res = await wx.cloud.callFunction({
          name: 'artworks',
          data: { action: 'listAll' }
        })
        
        // @ts-ignore
        const result = (res.result || {}) as any
        if (!result.ok) {
          throw new Error(result.error || 'callFunction failed')
        }
        
        const allDocs = (result.data || []) as any[]

        const artworks: ArtworkItem[] = []

        // 加载所有作品的缩略图（使用数据库中的 thumbnailFileId）
        const loadPromises = allDocs.map(async (doc: any) => {
          const thumbnailFileId = doc.thumbnailFileId || ''
          
          // 如果没有缩略图，跳过
          if (!thumbnailFileId) {
            return
          }

          try {
            const downloadRes = await wx.cloud.downloadFile({ fileID: thumbnailFileId })
            
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
            }

            artworks.push({
              id: doc._id,
              _openid: doc._openid || '',
              createdAt: doc.createdAt || 0,
              fileID: thumbnailFileId,
              tempFilePath: downloadRes.tempFilePath,
              aspectRatio,
            })
          } catch (err) {
            console.warn(`加载作品 ${doc._id} 缩略图失败`, err)
            // 忽略加载失败的图片
          }
        })

        await Promise.all(loadPromises)

        // 按 createdAt 降序排序（确保顺序正确）
        artworks.sort((a, b) => b.createdAt - a.createdAt)

        this.setData({ artworks, loading: false })
      } catch (err: any) {
        console.error('加载作品失败', err)
        wx.showToast({ title: '加载失败', icon: 'none' })
        this.setData({ loading: false })
      }
    },
  },
})

