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
    height: 0,
    scrollTop: 0,
    contentOpacity: 1,
    scrollState: {
      running: false,
      speed: 5,
      maxScroll: 0,
      initialScrollTop: 0
    },
    clearTransformTrigger: false
  },

  lifetimes: {
    attached() {
      // @ts-ignore
      const systemInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      const { statusBarHeight, windowHeight } = systemInfo
      this.setData({
        paddingTop: statusBarHeight + 12,
        height: windowHeight
      })
      this.loadArtworks()
    },
    detached() {
      this.clearAllTimers()
    },
  },

  pageLifetimes: {
    show() {
      // 保持屏幕常亮
      wx.setKeepScreenOn({
        keepScreenOn: true
      })
      // 页面显示时尝试恢复滚动
      if (this.data.artworks.length > 0 && !this.data.loading) {
        this.resumeAutoScroll()
      }
    },
    hide() {
      // 页面隐藏时，停止滚动
      this.setData({
        scrollState: { ...this.data.scrollState, running: false }
      })
      this.clearAllTimers()
    }
  },

  methods: {
    goBack() {
      wx.navigateBack()
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
          this.setData({ 
            artworks: cachedArtworks, 
            loading: false,
            contentOpacity: 1
          }, () => {
            this.startAutoScroll()
          })
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

        this.setData({ 
          artworks, 
          loading: false,
          contentOpacity: 1
        }, () => {
          this.startAutoScroll(forceRefresh) // 如果是强制刷新，说明是重新开始
        })
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

    // WXS 回调：自动滚动结束
    onAutoScrollFinish() {
      this.handleScrollFinish()
    },

    // WXS 回调：用户打断滚动
    onScrollInterrupted(e: any) {
      // callMethod 传递的参数直接就是对象，不是 event.detail
      const currentScrollTop = e.scrollTop !== undefined ? e.scrollTop : (e.detail && e.detail.scrollTop)
      console.log('用户触摸，停止自动滚动，当前位置:', currentScrollTop)
      this.clearAllTimers()

      // 同步位置: 设置原生 scrollTop, 并触发清除 WXS transform
      this.setData({
        scrollTop: currentScrollTop,
        scrollState: { ...this.data.scrollState, running: false },
        clearTransformTrigger: true
      }, () => {
        // 重置 trigger 以便下次使用
        this.setData({ clearTransformTrigger: false })
      })
    },

    onScrollTouch() {
      // 仅用于原生滚动时的触发，WXS touchStart 处理了自动滚动时的触摸
      console.log('用户触摸 (Native)')
      this.clearAllTimers()
      this.setData({
        scrollState: { ...this.data.scrollState, running: false }
      })
    },

    onScrollTouchEnd() {
      console.log('用户触摸结束，3秒后恢复自动滚动')
      // @ts-ignore
      this._resumeTimer = setTimeout(() => {
        this.resumeAutoScroll()
      }, 3000)
    },

    resumeAutoScroll() {
       this.createSelectorQuery()
        .select('.content')
        .scrollOffset((res) => {
          if (res) {
            console.log('恢复自动滚动，当前位置:', res.scrollTop)
            this.startAutoScroll(false, res.scrollTop)
          }
        })
        .exec()
    },

    startAutoScroll(restart = false, startTop = 0) {
      this.clearAllTimers()
      
      this.setData({
        scrollState: { ...this.data.scrollState, running: false },
        clearTransformTrigger: true // 确保开始前没有残留 transform
      })

      // 延迟确保渲染和状态重置完成
      // @ts-ignore
      this._startScrollTimeout = setTimeout(() => {
        this.createSelectorQuery()
          .select('.content')
          .boundingClientRect()
          .select('.grid')
          .boundingClientRect()
          .exec((res) => {
            if (!res[0] || !res[1]) return
            
            const scrollViewHeight = res[0].height
            const contentHeight = res[1].height
            const maxScroll = contentHeight - scrollViewHeight

            if (maxScroll <= 0) return

            console.log('开始自动滚动 (WXS)，最大滚动距离:', maxScroll)
            
            let currentTop = startTop
            if (this.data.scrollTop > 0 && !restart) {
                currentTop = this.data.scrollTop
            }

            // 如果是重新开始（比如刷新后），强制归零
            if (restart) {
              currentTop = 0
              this.setData({ scrollTop: 0 })
            }

            const speed = wx.getStorageSync('album_scroll_speed') || 5 

            // 启动 WXS 滚动
            this.setData({
                scrollState: {
                    running: true,
                    speed: speed,
                    maxScroll: maxScroll,
                    initialScrollTop: currentTop
                }
            })
          })
      }, 500)
    },

    handleScrollFinish() {
      console.log('滚动到底部，等待刷新...')
      this.setData({ scrollState: { ...this.data.scrollState, running: false } }) // 确保 WXS 状态停止

      // @ts-ignore
      this._finishTimer1 = setTimeout(() => {
        // 淡出
        this.setData({ contentOpacity: 0 })

        // 等待动画结束 (500ms)
        // @ts-ignore
        this._finishTimer2 = setTimeout(() => {
          // 跳回顶部
          this.setData({ scrollTop: 0 })
          
          // 刷新数据，加载完毕后会自动 fade in 并 startAutoScroll(restart=true)
          this.loadArtworks(true)
        }, 500)
      }, 2000)
    },

    clearAllTimers() {
      // @ts-ignore
      if (this._scrollTimer) {
        // @ts-ignore
        clearInterval(this._scrollTimer)
        // @ts-ignore
        this._scrollTimer = null
      }
      // WXS 模式下主要靠 state 控制停止，但也清理其他 timer
      
      // @ts-ignore
      if (this._startScrollTimeout) {
        // @ts-ignore
        clearTimeout(this._startScrollTimeout)
        // @ts-ignore
        this._startScrollTimeout = null
      }

      // @ts-ignore
      if (this._resumeTimer) {
        // @ts-ignore
        clearTimeout(this._resumeTimer)
        // @ts-ignore
        this._resumeTimer = null
      }

      // @ts-ignore
      if (this._finishTimer1) {
        // @ts-ignore
        clearTimeout(this._finishTimer1)
        // @ts-ignore
        this._finishTimer1 = null
      }

      // @ts-ignore
      if (this._finishTimer2) {
        // @ts-ignore
        clearTimeout(this._finishTimer2)
        // @ts-ignore
        this._finishTimer2 = null
      }
    },
  },
})

