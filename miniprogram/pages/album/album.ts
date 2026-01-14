// pages/album/album.ts
type ArtworkItem = {
  id: string
  _openid: string
  createdAt: number
  fileID: string
  tempFilePath: string
  aspectRatio?: number
}

type CachedArtworkData = {
  artworks: ArtworkItem[]
  timestamp: number
}

const CACHE_KEY = 'album_artworks_cache'
const CACHE_EXPIRE_TIME = 5 * 60 * 1000 // 5分钟缓存过期时间

Component({
  data: {
    paddingTop: 0,
    artworks: [] as ArtworkItem[],
    loading: false,
    scrollTop: 0, // 当前滚动位置
    contentOpacity: 1, // 内容透明度，用于动画
  },

  // 这里的 timer 需要放在此处或 methods 外，但在 Component 中通常挂在 this 上比较好
  // 由于 Component 定义限制，我们在 attached 里初始化，detached 里清理
  // 但 TS 类型检查可能会报错，所以也可以放在文件级变量（如果是单例页面）
  // 考虑到 album 可能是单独页面，文件级变量也行，只要 exit 时清理
  
  lifetimes: {
    attached() {
      const { statusBarHeight } = wx.getSystemInfoSync()
      this.setData({
        paddingTop: statusBarHeight + 12
      })
      this.loadArtworks()
    },
    detached() {
      this.stopAutoScroll()
    }
  },
  
  pageLifetimes: {
    show() {
       // 页面显示时，开始自动滚动
       if (!this.data.loading && this.data.artworks.length > 0) {
         this.startAutoScroll()
       }
    },
    hide() {
       // 页面隐藏时，停止滚动
       this.stopAutoScroll()
    }
  },

  methods: {
    goBack() {
      wx.navigateBack()
    },

    onTouchStart() {
      // 用户开始触摸，停止自动滚动
      const self = this as any
      self._isUserInteracting = true
      this.stopAutoScroll()
      
      // 清除恢复滚动的定时器
      if (self._resumeTimer) {
        clearTimeout(self._resumeTimer)
        self._resumeTimer = null
      }
    },

    onTouchEnd() {
      const self = this as any
      // 用户手指离开
      self._isUserInteracting = false
      
      // 延迟一段时间后恢复自动滚动
      // 3秒无操作后恢复
      self._resumeTimer = setTimeout(() => {
        // 只有当不在底部等待状态时才恢复滚动
        if (!self._isWaiting && !self._isUserInteracting) {
          this.startAutoScroll()
        }
      }, 3000)
    },

    // 需要监听滚动事件以更新 data.scrollTop
    onScroll(e: any) {
      // 这里的操作是关键：
      // 我们需要让 this.data.scrollTop 保持最新，以便 autoScroll 从正确位置开始。
      // 但是直接修改 this.data 而不 setData 是不推荐的，且不会影响视图。
      // 然而这里我们 *只* 需要它作为下次计算的基准。
      // 如果频繁调用 setData 会导致性能问题。
      this.data.scrollTop = e.detail.scrollTop
    },

    startAutoScroll() {
      const self = this as any
      // 停止之前的滚动
      this.stopAutoScroll()
      
      // 如果正在用户交互或者已经在等待，不要启动
      if (self._isUserInteracting || self._isWaiting) return

      // 读取配置
      const speed = wx.getStorageSync('album_scroll_speed') || 20
      // 映射速度: 1-100 -> 0.5px - 5px / 50ms
      const pixelStep = Math.max(0.5, speed / 10)

      self._scrollTimer = setInterval(() => {
        if (self._isWaiting || self._isUserInteracting) {
          this.stopAutoScroll()
          return
        }

        // 简单的自增滚动
        const nextScrollTop = this.data.scrollTop + pixelStep
        this.setData({ scrollTop: nextScrollTop })
      }, 50)
    },

    stopAutoScroll() {
      const self = this as any
      if (self._scrollTimer) {
        clearInterval(self._scrollTimer)
        self._scrollTimer = null
      }
    },

    onScrollToLower() {
      const self = this as any
      if (self._isWaiting) return
      self._isWaiting = true

      const waitTime = wx.getStorageSync('album_wait_time')
      const waitMs = (waitTime === '' ? 5 : waitTime) * 1000

      console.log(`到底了，等待 ${waitMs / 1000} 秒`)

      // 使用 setTimeout 处理等待和重置
      setTimeout(() => {
        // 1. 渐隐
        this.setData({ contentOpacity: 0 })

        setTimeout(() => {
          // 2. 回到顶部 (瞬间)
          this.setData({ scrollTop: 0 })

          // 3. 渐显
          setTimeout(() => {
            this.setData({ contentOpacity: 1 })
            // 重置等待状态，恢复滚动
            self._isWaiting = false
          }, 600) // 稍大于 transition 时间确保平滑

        }, 500) // 等待渐隐动画完成

      }, waitMs)
    },


    // 从缓存加载
    loadFromCache(): ArtworkItem[] | null {
      try {
        const cached = wx.getStorageSync(CACHE_KEY) as CachedArtworkData | null
        if (!cached) return null
        
        const now = Date.now()
        if (now - cached.timestamp > CACHE_EXPIRE_TIME) {
          // 缓存已过期
          return null
        }
        
        // 验证缓存数据有效性
        if (!Array.isArray(cached.artworks)) {
          return null
        }
        
        console.log('从缓存加载作品，数量:', cached.artworks.length)
        return cached.artworks
      } catch (err) {
        console.warn('读取缓存失败', err)
        return null
      }
    },

    // 保存到缓存
    saveToCache(artworks: ArtworkItem[]) {
      try {
        const cacheData: CachedArtworkData = {
          artworks,
          timestamp: Date.now(),
        }
        wx.setStorageSync(CACHE_KEY, cacheData)
        console.log('已保存到缓存，数量:', artworks.length)
      } catch (err) {
        console.warn('保存缓存失败', err)
      }
    },

    async loadArtworks(forceRefresh = false) {
      if (!wx.cloud) {
        wx.showToast({ title: '未检测到云开发能力', icon: 'none' })
        return
      }

      // 先尝试从缓存加载（如果不是强制刷新）
      if (!forceRefresh) {
        const cachedArtworks = this.loadFromCache()
        if (cachedArtworks && cachedArtworks.length > 0) {
          this.setData({ artworks: cachedArtworks, loading: false })
          // 后台刷新数据
          this.loadArtworks(true)
          return
        }
      }

      this.setData({ loading: true })

      try {
        // 使用云函数获取所有作品（云函数能一次请求100条，效率更高）
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
        console.log('获取到的作品数量:', allDocs.length)

        const artworks: ArtworkItem[] = []
        
        // 加载缓存中的缩略图路径映射
        const thumbnailCache = this.getThumbnailCache()

        // 加载所有作品的缩略图（使用数据库中的 thumbnailFileId）
        const loadPromises = allDocs.map(async (doc: any) => {
          const thumbnailFileId = doc.thumbnailFileId || ''
          
          // 如果没有缩略图，跳过
          if (!thumbnailFileId || thumbnailFileId.trim() === '') {
            return
          }

          try {
            // 检查缓存中是否已有该缩略图
            let tempFilePath = thumbnailCache[thumbnailFileId]
            let aspectRatio: number | undefined = thumbnailCache[`${thumbnailFileId}_ratio`]
            
            if (!tempFilePath) {
              // 缓存中没有，需要下载
              const downloadRes = await wx.cloud.downloadFile({ fileID: thumbnailFileId })
              tempFilePath = downloadRes.tempFilePath
              
              // 保存到缓存
              this.saveThumbnailToCache(thumbnailFileId, tempFilePath)
            }

            // 如果缓存中没有宽高比，获取图片信息
            if (!aspectRatio) {
              try {
                const imageInfo = await new Promise<WechatMiniprogram.GetImageInfoSuccessCallbackResult>((resolve, reject) => {
                  wx.getImageInfo({
                    src: tempFilePath,
                    success: resolve,
                    fail: reject,
                  })
                })
                aspectRatio = imageInfo.width / imageInfo.height
                // 保存宽高比到缓存
                this.saveThumbnailRatioToCache(thumbnailFileId, aspectRatio)
              } catch (err) {
                console.warn('获取图片信息失败', err)
              }
            }

            artworks.push({
              id: doc._id,
              _openid: doc._openid || '',
              createdAt: doc.createdAt || 0,
              fileID: thumbnailFileId,
              tempFilePath,
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

        // 保存到缓存
        this.saveToCache(artworks)

        this.setData({ artworks, loading: false })
      } catch (err: any) {
        console.error('加载作品失败', err)
        wx.showToast({ title: '加载失败', icon: 'none' })
        this.setData({ loading: false })
      }
    },

    // 获取缩略图缓存
    getThumbnailCache(): Record<string, any> {
      try {
        return wx.getStorageSync('album_thumbnail_cache') || {}
      } catch {
        return {}
      }
    },

    // 保存缩略图到缓存
    saveThumbnailToCache(fileID: string, tempFilePath: string) {
      try {
        const cache = this.getThumbnailCache()
        cache[fileID] = tempFilePath
        wx.setStorageSync('album_thumbnail_cache', cache)
      } catch (err) {
        console.warn('保存缩略图缓存失败', err)
      }
    },

    // 保存宽高比到缓存
    saveThumbnailRatioToCache(fileID: string, ratio: number) {
      try {
        const cache = this.getThumbnailCache()
        cache[`${fileID}_ratio`] = ratio
        wx.setStorageSync('album_thumbnail_cache', cache)
      } catch (err) {
        console.warn('保存宽高比缓存失败', err)
      }
    },
  },
})

