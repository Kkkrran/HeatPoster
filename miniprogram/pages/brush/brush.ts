import drawQrcode from '../../SUPVANAPIT50PRO/weapp.qrcode.esm.js'

const MAX_EXPORT_WIDTH = 1169
const MAX_EXPORT_HEIGHT = 1559

Page({
  data: {
    toolsVisible: false,
    lineMax: 30,
    lineMin: 5,
    linePressure: 2.5,
    smoothness: 80, // Higher = smoother but more lag? HTML used 80-100.
    
    backgroundImage: '',
    permanentBackgroundImage: '',
    permanentBackgroundAspectRatio: undefined as number | undefined,
    canvasContainerStyle: '',
    
    openid: '',
    artworkId: '',
    isCanvasHidden: false,
    snapshotUrl: '',
    qrCodeUrl: '', // 下载链接的二维码图片路径
  },


  canvas: null as any,
  ctx: null as any,
  dpr: 1,
  width: 0,
  height: 0,
  brushImg: null as any,
  isBrushLoaded: false,
  
  // Handwriting state
  moveFlag: false,
  upof: { x: 0, y: 0 },
  radius: 0,
  has: [] as any[],
  arr: [] as any[],
  l: 20,

  async onLoad(options: any) {
    if (options && options.id) {
      this.setData({ artworkId: options.id })
    } else {
      this.setData({ artworkId: `practice_${Date.now()}` })
    }

    await this.getOpenId()
    await this.loadPermanentBackground()
    // Wait for view to stabilize?
    setTimeout(() => {
        this.initCanvas()
    }, 100)
  },

  onShow() {
    // Reload background if changed in settings? 
    // Usually settings page updates storage, so check it.
    // editor.ts does this.
    // But initializing canvas multiple times might be bad if we want to keep drawing.
    // We only reload if we assume user came from settings and might have changed BG.
    // But this clears canvas if we re-init.
    // So maybe just check if BG changed and redraw BG?
    // For now, simple implementation: load once on Load.
  },

  async getOpenId() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'editor', // reuse editor cloud function for openid
        data: { action: 'getOpenId' }
      })
      const result = res.result as any
      if (result.ok) {
        this.setData({ openid: result.data.openid })
      }
    } catch (e) {
      console.error('getOpenId failed', e)
    }
  },

  async loadPermanentBackground() {
    try {
      let selectedBg = wx.getStorageSync('selected_background')
      
      // 如果没有缓存，则使用默认背景
      if (!selectedBg) {
        selectedBg = {
           name: '默认背景',
           tempFilePath: '/images/bglocal.png'
        }
        // 对于本地默认背景，尝试获取信息
        try {
           const imageInfo = await wx.getImageInfo({ src: selectedBg.tempFilePath })
           selectedBg.aspectRatio = imageInfo.width / imageInfo.height
        } catch(e) {
           // 如果获取信息也失败，可能默认背景图也不存在，则不设置
           console.warn('Cannot load default bg info', e)
        }
      }

      if (selectedBg && selectedBg.tempFilePath) {
        this.setData({ 
          permanentBackgroundImage: selectedBg.tempFilePath 
        })
        if (selectedBg.aspectRatio) {
          this.setData({ permanentBackgroundAspectRatio: selectedBg.aspectRatio })
        } else {
            // Calculate if missing
            const imageInfo = await wx.getImageInfo({ src: selectedBg.tempFilePath })
            const ar = imageInfo.width / imageInfo.height
            this.setData({ permanentBackgroundAspectRatio: ar })
        }
      } else {
        // 如果依然没有背景（例如默认背景图加载失败），确保清空状态
         this.setData({ 
          permanentBackgroundImage: '',
          permanentBackgroundAspectRatio: undefined 
        })
      }
      
      // 重新布局 Canvas
      this.initCanvas()
    } catch (err) {
      console.error('loadPermanentBackground fail', err)
    }
  },

  initCanvas() {
    const query = this.createSelectorQuery()
    query.select('.canvas-wrap').boundingClientRect().exec((wrapRes) => {
      const wrapInfo = wrapRes[0]
      if (!wrapInfo) return

      // Handle Aspect Ratio: 严格约束画布比例使其与常驻背景一致
      let canvasContainerStyle = ''
      if (this.data.permanentBackgroundAspectRatio) {
        const aspectRatio = this.data.permanentBackgroundAspectRatio

        const maxWidth = wrapInfo.width - 48 // 减去左右padding
        const maxHeight = wrapInfo.height - 24 // 减去底部padding

        // 计算适合的尺寸（保持比例，尽量填满容器）
        let targetWidth = maxHeight * aspectRatio
        let targetHeight = maxHeight
        
        // 如果宽度超出容器，则按宽度缩放
        if (targetWidth > maxWidth) {
          targetWidth = maxWidth
          targetHeight = maxWidth / aspectRatio
        }
        
        // 设置canvas容器的样式（使用rpx单位）
        const systemInfo = wx.getSystemInfoSync()
        const rpxRatio = systemInfo.windowWidth / 750
        const targetWidthRpx = targetWidth / rpxRatio
        const targetHeightRpx = targetHeight / rpxRatio
        canvasContainerStyle = `width: ${targetWidthRpx}rpx; height: ${targetHeightRpx}rpx; margin: 0 auto;`
      }
      
      this.setData({ canvasContainerStyle }, () => {
          // If using style, give it time to render
          setTimeout(() => {
              this.initCanvasContext()
          }, canvasContainerStyle ? 100 : 50)
      })
    })
  },

  initCanvasContext() {
      const query = this.createSelectorQuery()
      query.select('#brushCanvas')
        .fields({ node: true, size: true })
        .exec((res) => {
            if (!res[0] || !res[0].node) return
            const canvas = res[0].node
            const ctx = canvas.getContext('2d')
            // @ts-ignore
            const dpr = wx.getSystemInfoSync().pixelRatio
            
            this.canvas = canvas
            this.ctx = ctx
            this.dpr = dpr
            
            canvas.width = res[0].width * dpr
            canvas.height = res[0].height * dpr
            ctx.scale(dpr, dpr)
            
            this.width = res[0].width
            this.height = res[0].height
            
            // Initial Drawing (Background)
            this.drawBackground()
            
            // Load Brush
            this.loadBrushImage()
        })
  },

  loadBrushImage() {
      const img = this.canvas.createImage()
      img.onload = () => {
          this.brushImg = img
          this.isBrushLoaded = true
      }
      img.src = '/images/pen2.png'
  },

  drawBackground() {
      if (!this.ctx) return
      this.ctx.clearRect(0, 0, this.width, this.height)
  },

  async getComposedImage() {
      return new Promise((resolve, reject) => {
          const query = this.createSelectorQuery()
          query.select('#exportCanvas')
              .fields({ node: true, size: true })
              .exec(async (res) => {
                  try {
                    if (!res[0] || !res[0].node) {
                        reject('Export canvas not found')
                        return
                    }
                    
                    const canvas = res[0].node
                    const ctx = canvas.getContext('2d')
                    const dpr = this.dpr || 1 // use same dpr
                    
                    // Use this.width/height which are logical pixels set in initCanvasContext
                    const w = this.width 
                    const h = this.height 
                    
                    canvas.width = w * dpr
                    canvas.height = h * dpr
                    ctx.scale(dpr, dpr)
                    
                    // 1. White Base
                    ctx.fillStyle = '#ffffff'
                    ctx.fillRect(0, 0, w, h)
                    
                    // 2. Permanent BG
                    if (this.data.permanentBackgroundImage) {
                        const img = canvas.createImage()
                        await new Promise<void>((r) => { 
                            img.onload = () => r(); 
                            img.onerror = () => r(); // ignore error
                            img.src = this.data.permanentBackgroundImage 
                        })
                        ctx.drawImage(img, 0, 0, w, h)
                    }
                    
                    // 3. Temp BG
                    if (this.data.backgroundImage) {
                        const img = canvas.createImage()
                        await new Promise<void>((r) => { 
                            img.onload = () => r();
                            img.onerror = () => r();
                            img.src = this.data.backgroundImage 
                        })
                        // Contain logic
                        const iW = img.width
                        const iH = img.height
                        
                        // avoid divide by zero
                        if (iW > 0 && iH > 0) {
                            const scale = Math.min(w / iW, h / iH)
                            const dW = iW * scale
                            const dH = iH * scale
                            const dx = (w - dW) / 2
                            const dy = (h - dH) / 2
                            ctx.drawImage(img, dx, dy, dW, dH)
                        }
                    }
                    
                    // 4. Strokes (Main Canvas)
                    if (this.canvas) {
                        ctx.drawImage(this.canvas, 0, 0, w, h)
                    }
                    
                    // 5. Export
                    setTimeout(() => {
                        wx.canvasToTempFilePath({
                            canvas: canvas,
                            fileType: 'png',
                            success: (r) => resolve(r.tempFilePath),
                            fail: reject
                        })
                    }, 100)
                  } catch(e) {
                      reject(e)
                  }
              })
      })
  },

  // Tools
  toggleTools() {
    if (!this.data.toolsVisible) {
      // 准备打开，先生成快照
      wx.canvasToTempFilePath({
        canvas: this.canvas,
        fileType: 'png',
        success: (res) => {
          this.setData({
            snapshotUrl: res.tempFilePath,
            isCanvasHidden: true,
            toolsVisible: true
          })
        },
        fail: (err) => {
          console.error('snapshot failed, normal open', err)
          this.setData({ toolsVisible: true })
        }
      })
    } else {
      this.setData({ 
        toolsVisible: false,
        isCanvasHidden: false
      })
    }
  },
  
  onToolsVisibleChange(e: any) {
    const visible = e.detail.visible
    if (!visible) {
      // 关闭弹窗时恢复 Canvas
      this.setData({ 
        toolsVisible: false,
        isCanvasHidden: false
      })
    } else {
        // 如果是通过其他方式（如拖拽？）触发打开，可能也需要快照
        // 但 toggleTools 已经处理了点击打开。我们这里只处理 visible 变化同步
        // 一般 T-Popup 点击遮罩关闭会触发 visible: false
        this.setData({ toolsVisible: visible })
        // 注意：如果不通过 toggleTools 打开，直接改变 visible，可能不会有快照
        // 但目前入口只有 toggleTools
    }
  },
  
  onLineWidthChange(e: any) {
      this.setData({ lineMax: e.detail.value })
  },

  // Events
  onTouchStart(e: any) {
      if (!this.isBrushLoaded) return
      this.moveFlag = true
      this.has = []
      this.arr = []
      this.l = this.data.lineMax
      
      const { x, y } = e.touches[0]
      this.upof = { x, y }
      this.arr.push({ x, y }) // Using unshift logic from HTML? Unshift puts it at 0.
      // HTML: arr.unshift({x1,y1})
      // I'll stick to push for order of time, or unshift for stack?
      // HTML `moveEvent` uses `arr.unshift`.
      // `upEvent` iterates `arr` from 0 to 60. So it processes the *most recent* points.
      this.arr.unshift({ x, y })
      
      // Draw first dot? HTML doesn't draw in downEvent.
  },
  
  onTouchMove(e: any) {
      if (!this.moveFlag || !this.isBrushLoaded) return
      const { x, y } = e.touches[0]
      const of = { x, y }
      const up = this.upof
      
      const d = this.distance(up, of) // implement distance
      this.has.unshift({ time: new Date().getTime(), dis: d })
      
      let sumDis = 0
      let timeDiff = 0
      for(let n=0; n < this.has.length - 1; n++) {
          sumDis += this.has[n].dis
          timeDiff += this.has[n].time - this.has[n+1].time
          if (sumDis > this.data.smoothness) break
      }
      
      let or = this.radius
      if (sumDis > 0) {
           or = Math.min(timeDiff / sumDis * this.data.linePressure + this.data.lineMin , this.data.lineMax) / 2
      }
      
      this.radius = or
      this.upof = of
      
      const len = Math.round(this.has[0].dis / 2) + 1
      for (let i = 0; i < len; i++) {
          const cx = up.x + (of.x - up.x) / len * i
          const cy = up.y + (of.y - up.y) / len * i
          
          let w = this.l
          let xDraw = cx - w / 2
          let yDraw = cy - w / 2
          
          this.arr.unshift({ x: xDraw, y: yDraw })
          this.ctx.drawImage(this.brushImg, xDraw, yDraw, w, w)
          
          this.l -= 0.1 // Less aggressive taper
          if (this.l < 10) this.l = 10
      }
  },
  
  onTouchEnd(_e: any) {
      this.moveFlag = false
      
      // Sharp tip effect
      if (this.arr.length > 5) {
          const loops = Math.min(this.arr.length, 30)
          for(let j = 0; j < loops; j++) {
              if (this.arr[j]) {
                this.arr[j].x = this.arr[j].x - this.l / 4
                this.arr[j].y = this.arr[j].y - this.l / 4
                // Re-draw? 
                // HTML: this.ctx.drawImage(this.img, arr[j].x, arr[j].y, l, l);
                // The `l` here continues to decrease from where it left off in moveEvent.
                
                this.ctx.drawImage(this.brushImg, this.arr[j].x, this.arr[j].y, this.l, this.l)
                
                this.l -= 0.3
                if (this.l < 2) this.l = 2
              }
          }
      }
      this.l = this.data.lineMax
      this.arr = []
  },
  
  distance(a: any, b: any) {
      return Math.sqrt(Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2))
  },
  
  onClear() {
      this.drawBackground()
      this.toast('已清空')
      this.toggleTools()
  },
  
  onImportBackground() {
      wx.chooseImage({
          count: 1,
          sizeType: ['compressed'],
          success: (res) => {
              const path = res.tempFilePaths[0]
              
              const draw = (p: string) => {
                   this.setData({ backgroundImage: p, toolsVisible: false, isCanvasHidden: false })
              }
              
              // Use crop if available? Editor uses wx.editImage.
              // @ts-ignore
              if (wx.editImage) {
                 // @ts-ignore
                 wx.editImage({
                     src: path,
                     success: (r: any) => draw(r.tempFilePath)
                 })
              } else {
                  draw(path)
              }
          }
      })
  },

  async saveToAlbum(filePath: string) {
    if (!filePath) return

    return new Promise<void>((resolve) => {
      wx.saveImageToPhotosAlbum({
        filePath,
        success: () => {
          this.toast('已保存到相册', 'success')
          resolve()
        },
        fail: (err: any) => {
          console.error('saveImageToPhotosAlbum failed', err)
          const errMsg = (err && err.errMsg) || ''
          if (errMsg.includes('auth') || errMsg.includes('authorize') || errMsg.includes('fail')) {
            wx.showModal({
              title: '需要授权',
              content: '请授权“保存到相册”以便导出图片',
              confirmText: '去设置',
              cancelText: '取消',
              success: (res) => {
                if (res.confirm) {
                  wx.openSetting()
                }
                resolve()
              },
              fail: () => resolve()
            })
          } else {
             this.toast('保存到相册失败', 'error')
             resolve()
          }
        }
      })
    })
  },
  
  onSave() {
     this.toast('保存中...', 'loading')
     this.setData({ toolsVisible: false })

     // 保存前先生成快照并隐藏 Canvas，防止遮挡即将显示的二维码
     if (this.canvas) {
        wx.canvasToTempFilePath({
            canvas: this.canvas,
            success: (res) => {
                this.setData({
                    snapshotUrl: res.tempFilePath,
                    isCanvasHidden: true
                })
                this.executeSave()
            },
            fail: (err) => {
                console.error('Snapshot failed', err)
                this.executeSave()
            }
        })
     } else {
         this.executeSave()
     }
  },

  async executeSave() {
     try {
         // 获取包含背景和笔触的合成图片
         // @ts-ignore
         const tempFile = await this.getComposedImage()
         
         const openid = this.data.openid || 'unknown'
         const id = this.data.artworkId
         const cloudPath = `MaoBi/${openid}/${id}.png`
         
         const uploadRes = await wx.cloud.uploadFile({
             cloudPath,
             filePath: tempFile as string
         })
         
         this.toast('保存成功', 'success')
         
         // 显示二维码
         if (uploadRes.fileID) {
             this.showDownloadQrCode(uploadRes.fileID)
         }

         // 同时保存到相册
         await this.saveToAlbum(tempFile as string)
     } catch (e) {
         console.error('Save failed', e)
         this.toast('保存失败', 'error')
         // 如果失败，恢复 Canvas
         this.setData({ isCanvasHidden: false })
     }
  },
  
  // 真正的生成二维码实现
  async drawQrCodeToPath(url: string): Promise<string> {
     return new Promise((resolve, reject) => {
         const query = this.createSelectorQuery()
         // 查找我们在 wxml 中添加的隐藏 canvas
         query.select('#qrCodeCanvas')
            .fields({ node: true, size: true })
            .exec(async (res) => {
                if (!res[0] || !res[0].node) {
                    console.error('Canvas #qrCodeCanvas not found')
                    reject('Canvas not found')
                    return
                }
                const canvas = res[0].node
                const ctx = canvas.getContext('2d')
                const dpr = wx.getSystemInfoSync().pixelRatio || 1
                
                const width = res[0].width
                const height = res[0].height
                
                canvas.width = width * dpr
                canvas.height = height * dpr
                ctx.scale(dpr, dpr)
                
                // 清空
                ctx.clearRect(0, 0, width, height)
                
                // 绘制二维码
                drawQrcode({
                    canvas: canvas,
                    canvasId: 'qrCodeCanvas',
                    width: width,
                    height: height,
                    padding: 0,
                    text: url,
                    background: '#ffffff',
                    foreground: '#000000',
                })
                
                // 导出为临时路径
                setTimeout(() => {
                    wx.canvasToTempFilePath({
                        canvas: canvas,
                        success: (res) => {
                            resolve(res.tempFilePath)
                        },
                        fail: reject
                    })
                }, 200)
            })
     })
  },

  async showDownloadQrCode(fileID: string) {
       try {
           const res = await wx.cloud.getTempFileURL({ fileList: [fileID] })
           if (!res.fileList || !res.fileList[0].tempFileURL) return
           
           const url = res.fileList[0].tempFileURL
           console.log('Generating QR code for:', url)
           const qrPath = await this.drawQrCodeToPath(url)
           
           this.setData({ qrCodeUrl: qrPath })
       } catch (e) {
           console.error('Show QR Code failed', e)
       }
  },

  preventBubble() {},
  
  preventScroll() {},

  onCloseQrCode() {
      this.setData({ 
          qrCodeUrl: '',
          isCanvasHidden: false 
      })
  },
  
  toast(message: string, theme: 'success' | 'error' | 'loading' = 'success') {
      const t = this.selectComponent('#t-toast') as any
      if (t) t.show({ message, theme, duration: 1500 })
  }
})
