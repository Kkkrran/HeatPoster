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
      const selectedBg = wx.getStorageSync('selected_background')
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
      }
    } catch (err) {
      console.error('loadPermanentBackground fail', err)
    }
  },

  initCanvas() {
    const query = this.createSelectorQuery()
    query.select('.canvas-wrap').boundingClientRect().exec((_wrapRes) => {
      // 就算获取不到，也尝试用系统信息兜底
      // const wrapInfo = wrapRes[0]
      // if (!wrapInfo) return

      // Handle Aspect Ratio: 严格约束画布比例使其与常驻背景一致
      let canvasContainerStyle = ''
      if (this.data.permanentBackgroundAspectRatio) {
        const ar = this.data.permanentBackgroundAspectRatio
        
        // 使用系统窗口尺寸，更可靠
        const sys = wx.getSystemInfoSync()
        // 留出一定的边距 (例如 5% 边距，即占用 90% 宽/高)
        const maxWidth = sys.windowWidth * 0.9
        const maxHeight = sys.windowHeight * 0.9
        
        // 尝试以宽度为基准 (宽占满 90%)
        let targetWidth = maxWidth
        let targetHeight = targetWidth / ar
        
        // 如果算出的高度超出了最大高度限制，则以高度为基准
        if (targetHeight > maxHeight) {
          targetHeight = maxHeight
          targetWidth = targetHeight * ar
        }
        
        // 设置画布容器大小，使其完全贴合背景比例，最大化利用屏幕空间
        canvasContainerStyle = `width: ${targetWidth}px; height: ${targetHeight}px;`
      }
      
      this.setData({ canvasContainerStyle }, () => {
          // Now fetch canvas node
          setTimeout(() => {
              this.initCanvasContext()
          }, 50)
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
      
      // Draw White Base
      this.ctx.fillStyle = '#f2e0ba' // Match CSS
      this.ctx.fillRect(0, 0, this.width, this.height)
      
      // Draw Permanent BG
      if (this.data.permanentBackgroundImage) {
          const img = this.canvas.createImage()
          img.onload = () => {
              // 画布尺寸已根据背景调整比例，直接全屏绘制（拉伸填满即为正确比例）
              this.ctx.drawImage(img, 0, 0, this.width, this.height)
              
              // Draw Temp BG on top if exists
              if (this.data.backgroundImage) {
                 this.drawTempDetails()
              }
          }
          img.src = this.data.permanentBackgroundImage
      } else if (this.data.backgroundImage) {
          this.drawTempDetails()
      }
  },
  
  drawTempDetails() {
      if (this.data.backgroundImage) {
          const img = this.canvas.createImage()
          img.onload = () => {
              // Draw temp bg. How to fit? Contain.
              // Center it.
              const iW = img.width
              const iH = img.height
              const cW = this.width
              const cH = this.height
              
              const scale = Math.min(cW / iW, cH / iH)
              const dW = iW * scale
              const dH = iH * scale
              const dx = (cW - dW) / 2
              const dy = (cH - dH) / 2
              
              this.ctx.drawImage(img, dx, dy, dW, dH)
          }
          img.src = this.data.backgroundImage
      }
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
                   this.setData({ backgroundImage: p }, () => {
                      this.drawBackground()
                   })
                   // 导入完成后恢复 Canvas 显示
                   this.setData({ 
                       toolsVisible: false,
                       isCanvasHidden: false
                   })
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
  
  async onSave() {
     this.toast('保存中...', 'loading')
     try {
         // Save to temp
         const tempFile = await new Promise((resolve, reject) => {
             wx.canvasToTempFilePath({
                 canvas: this.canvas,
                 fileType: 'png',
                 success: (res) => resolve(res.tempFilePath),
                 fail: reject
             })
         })
         
         const openid = this.data.openid || 'unknown'
         const id = this.data.artworkId
         const cloudPath = `MaoBi/${openid}/${id}.png`
         
         await wx.cloud.uploadFile({
             cloudPath,
             filePath: tempFile as string
         })
         
         this.toast('保存成功', 'success')

         // 同时保存到相册
         await this.saveToAlbum(tempFile as string)
     } catch (e) {
         console.error('Save failed', e)
         this.toast('保存失败', 'error')
     }
  },
  
  toast(message: string, theme: 'success' | 'error' | 'loading' = 'success') {
      const t = this.selectComponent('#t-toast') as any
      if (t) t.show({ message, theme, duration: 1500 })
  }
})
