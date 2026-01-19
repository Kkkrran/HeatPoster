// 导入打印管理模块
import { PrintManager, DEFAULT_PRINT_SETTINGS } from '../editor/printManager'
import drawQrcode from '../../SUPVANAPIT50PRO/weapp.qrcode.esm.js'

Page({
  data: {
    toolsVisible: false,
    lineMax: 30,
    lineMin: 5,
    linePressure: 2.5,
    smoothness: 80, // Higher = smoother but more lag? HTML used 80-100.
    
    permanentBackgroundImage: '',
    permanentBackgroundAspectRatio: undefined as number | undefined,
    canvasContainerStyle: '',
    
    openid: '',
    artworkId: '',
    isCanvasHidden: false,
    snapshotUrl: '',
    
    // 打印相关
    connectedDevice: null as any,
    canvasText: null as any,
    canvasBarCode: null as any,
    printSettingsVisible: false,
    templateWidth: 400,
    templateHeight: 240,
    barCodeWidth: 214,
    barCodeHeight: 72,
    pixelRatio: 1,
    printNum: 0,
    // 打印参数（默认值从 printManager 导入）
    ...DEFAULT_PRINT_SETTINGS,
    
    canUndo: false,
    canRedo: false,
  },


  canvas: null as any,
  ctx: null as any,
  dpr: 1,
  width: 0,
  height: 0,
  brushImg: null as any,
  isBrushLoaded: false,
  
  history: [] as any[],
  historyIndex: -1,
  maxUndoSteps: 10,

  // Handwriting state
  moveFlag: false,
  upof: { x: 0, y: 0 },
  radius: 0,
  l: 10,
  arr: [] as any[],
  has: [] as any[],

  // 打印管理器
  printManager: null as any,

  async onLoad(options: any) {
    if (options && options.id) {
      this.setData({ artworkId: options.id })
    } else {
      this.setData({ artworkId: `practice_${Date.now()}` })
    }

    // 初始化打印管理器
    Object.assign(this, {
      printManager: new PrintManager(this)
    })

    const maxUndoSteps = wx.getStorageSync('editor_max_undo_steps') || 10
    this.maxUndoSteps = maxUndoSteps

    await this.getOpenId()
    await this.loadPermanentBackground()
    // Wait for view to stabilize?
    this.initCanvas()
    
    // 初始化打印相关
    // @ts-ignore
    const systemInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const pixelRatio = systemInfo.pixelRatio || 1
    this.setData({ pixelRatio })
    
    const self = this as any
    if (self.printManager) {
      self.printManager.initPrintCanvas()
      // 使用 syncConnectionFromStorage 而不是 checkPrinterConnection
      // 这样可以保持连接状态，不会在页面加载时清除已连接的设备
      self.printManager.syncConnectionFromStorage()
      self.printManager.loadPrintSettings()
    }
  },

  onShow() {
    this.loadPermanentBackground()
    // 每次显示页面时同步打印机连接状态（仅在当前会话中）
    // 如果用户在 settings 页面连接了设备，切换到 brush 页面时能看到连接状态
    const self = this as any
    if (self.printManager) {
      self.printManager.syncConnectionFromStorage()
    }
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
      // 强制使用默认背景 bgbrush.jpg
      const path = '/images/bgbrush.jpg'
      
      try {
         const imageInfo = await wx.getImageInfo({ src: path })
         this.setData({ 
           permanentBackgroundImage: path,
           permanentBackgroundAspectRatio: imageInfo.width / imageInfo.height
         })
      } catch(e) {
         console.warn('默认背景 bgbrush.jpg 加载失败', e)
         // 尝试加载 png
         try {
            const pngPath = '/images/bgbrush.png'
            const imageInfo = await wx.getImageInfo({ src: pngPath })
            this.setData({ 
              permanentBackgroundImage: pngPath,
              permanentBackgroundAspectRatio: imageInfo.width / imageInfo.height
            })
         } catch(err) {
            this.setData({ 
                permanentBackgroundImage: '',
                permanentBackgroundAspectRatio: undefined 
            })
         }
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
        // @ts-ignore
        const systemInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
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
            const dpr = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).pixelRatio
            
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
            
            // Ensure first history state is saved
            this.saveHistory()

            // Load Brush
            this.loadBrushImage()
        })
  },

  saveHistory() {
      if (!this.ctx || !this.canvas) return
      
      try {
        const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height)
        
        // 如果当前不在最新，清除后面的 redo 历史
        if (this.historyIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.historyIndex + 1)
        }
        
        // 压入新状态
        this.history.push(imageData)
        
        // 限制长度
        if (this.history.length > this.maxUndoSteps + 1) {
            this.history.shift()
        } else {
            this.historyIndex++
        }
        
        this.updateUndoRedoState()
      } catch (e) {
          console.error("Save history failed:", e)
      }
  },

  onUndo() {
      if (this.historyIndex > 0) {
          this.historyIndex--
          const imageData = this.history[this.historyIndex]
          this.ctx.putImageData(imageData, 0, 0)
          this.updateUndoRedoState()
      }
  },

  onRedo() {
      if (this.historyIndex < this.history.length - 1) {
          this.historyIndex++
          const imageData = this.history[this.historyIndex]
          this.ctx.putImageData(imageData, 0, 0)
          this.updateUndoRedoState()
      }
  },
  
  updateUndoRedoState() {
      this.setData({
          canUndo: this.historyIndex > 0,
          canRedo: this.historyIndex < this.history.length - 1
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

  // 统一的图片生成逻辑（私有方法）
  async _generateComposedImage(quality: number): Promise<string> {
    const self = this as any
    if (!self.canvas) return Promise.reject('Canvas not initialized')

    // 使用固定标准尺寸（最大边不超过810和1080）
    // 假设原始比例约为 0.75，这里设置为 810x1080
    // 如果需要更严格的比例，可以根据实际情况调整
    const standardWidth = 810
    const standardHeight = 1080

    // 创建离屏 Canvas 用于合成（使用标准尺寸）
    // @ts-ignore
    const offCanvas = wx.createOffscreenCanvas({ type: '2d', width: standardWidth, height: standardHeight })
    const offCtx = offCanvas.getContext('2d')

    // 1. 填充白底
    offCtx.fillStyle = '#ffffff'
    offCtx.fillRect(0, 0, standardWidth, standardHeight)

    // 2. 绘制常驻背景（拉伸填满）
    if (this.data.permanentBackgroundImage) {
      // @ts-ignore
      const img = offCanvas.createImage()
      await new Promise((resolve) => {
        img.onload = resolve
        img.onerror = resolve
        img.src = this.data.permanentBackgroundImage
      })
      offCtx.drawImage(img, 0, 0, standardWidth, standardHeight)
    }

    // 3. 绘制当前笔迹（拉伸填满）
    offCtx.drawImage(self.canvas, 0, 0, standardWidth, standardHeight)

    // 4. 导出 JPG
    return new Promise((resolve, reject) => {
      wx.canvasToTempFilePath({
        canvas: offCanvas,
        destWidth: standardWidth,
        destHeight: standardHeight,
        fileType: 'jpg',
        quality: quality,
        success: (res) => resolve(res.tempFilePath),
        fail: reject
      })
    })
  },

  // 生成用于保存或打印的高质量图片
  async getComposedImage() {
      return this._generateComposedImage(0.9)
  },

  // 生成用于防遮挡的快照（略低质量）
  async getSnapshotImage() {
      // 避免报错，如果还没初始化
      const self = this as any
      if (!self.canvas) return ''
      try {
          return await this._generateComposedImage(0.8)
      } catch (e) {
          console.error('Snapshot failed', e)
          return ''
      }
  },


  
  async toggleTools() {
    const willShow = !this.data.toolsVisible
    if (willShow) {
      // 打开工具栏前，生成快照并隐藏 Canvas，防止遮挡
      try {
        const snapshotUrl = await this.getSnapshotImage()
        this.setData({
          snapshotUrl,
          isCanvasHidden: true,
          toolsVisible: true
        })
      } catch (err) {
        console.error('Snapshot failed', err)
        // 失败降级：直接显示，可能遮挡
        this.setData({ toolsVisible: true })
      }
    } else {
      // 关闭工具栏
      // 主动关闭时，手动恢复 Canvas 状态，确保触摸事件恢复
      this.setData({ 
        toolsVisible: false,
        isCanvasHidden: false,
        snapshotUrl: '' // 清除快照
      })
    }
  },

  onToolsVisibleChange(e: any) {
    const visible = e.detail.visible
    if (!visible) {
      // 关闭弹窗时恢复 Canvas
      this.setData({ 
        toolsVisible: false,
        isCanvasHidden: false,
        snapshotUrl: '' // 清除快照
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
      
      this.has = []
      this.radius = 0
      
      this.saveHistory()
  },
  
  distance(a: any, b: any) {
      return Math.sqrt(Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2))
  },
  
  onClear() {
      this.drawBackground()
      this.saveHistory()
      this.toast('已清空')
      this.toggleTools()
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
  
  // 保存功能已合并到打印流程中，保留此方法供其他需要时调用
  async uploadToCloudStorage(): Promise<string> {
     try {
         // 获取包含背景和笔触的合成图片
         // @ts-ignore
         const tempFile = await this.getComposedImage()
         
         const openid = this.data.openid || 'unknown'
         const id = this.data.artworkId
         const cloudPath = `MaoBi/${openid}/${id}.jpg`
         
         const uploadRes = await wx.cloud.uploadFile({
             cloudPath,
             filePath: tempFile as string
         })
         
         this.toast('保存成功', 'success')
         
         // 显示二维码
         if (uploadRes.fileID) {
             this.showDownloadQrCode(uploadRes.fileID)
         }
         
         return uploadRes.fileID
     } catch (e) {
         console.error('Upload to cloud storage failed', e)
         throw e
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
          isCanvasHidden: false,
          artworkId: `practice_${Date.now()}`
      })
      
      // 完全重置画布和历史
      this.history = []
      this.historyIndex = -1
      this.drawBackground()
      this.saveHistory() // 保存初始空白状态
  },
  
  toast(message: string, theme: 'success' | 'error' | 'loading' = 'success') {
      const t = this.selectComponent('#t-toast') as any
      if (t) t.show({ message, theme, duration: 1500 })
  },

  // ========== 打印功能 ==========
  // 点击打印按钮 - 直接使用默认参数进行打印
  onPrint() {
    const self = this as any

    // 使用打印管理器检查是否可以打印（保留连接检测逻辑）
    if (self.printManager) {
      const checkResult = self.printManager.canPrint()
      if (!checkResult.canPrint) {
        if (checkResult.message?.includes('未连接打印机')) {
          wx.showModal({
            title: '未连接打印机',
            content: checkResult.message,
            showCancel: true,
            confirmText: '去设置',
            cancelText: '取消',
            success: (res) => {
              if (res.confirm) {
                wx.navigateTo({ url: '/pages/settings/settings' })
              }
            }
          })
        } else {
          this.toast(checkResult.message || '无法打印', 'error')
        }
        return
      }
    }

    // 打印机已连接，直接使用默认参数进行打印（不显示参数设置弹窗）
    this.onConfirmPrint()
  },

  // 关闭打印参数设置弹窗
  onClosePrintSettings() {
    this.setData({ printSettingsVisible: false })
  },

  // 打印参数变化处理
  onPrintWidthChange(e: any) {
    console.log('onPrintWidthChange', e)
    // TDesign input 的 change 事件返回 { value: string }
    const inputValue = e.detail?.value !== undefined ? e.detail.value : (e.detail || '')
    const value = parseFloat(String(inputValue))
    if (!isNaN(value) && value > 0) {
      this.setData({ printWidth: value })
    }
  },

  onPrintHeightChange(e: any) {
    console.log('onPrintHeightChange', e)
    // TDesign input 的 change 事件返回 { value: string }
    const inputValue = e.detail?.value !== undefined ? e.detail.value : (e.detail || '')
    const value = parseFloat(String(inputValue))
    if (!isNaN(value) && value > 0) {
      this.setData({ printHeight: value })
    }
  },

  onPrintCopiesChange(e: any) {
    console.log('onPrintCopiesChange', e)
    // TDesign input 的 change 事件返回 { value: string }
    const inputValue = e.detail?.value !== undefined ? e.detail.value : (e.detail || '')
    const value = parseInt(String(inputValue))
    if (!isNaN(value) && value > 0) {
      this.setData({ printCopies: Math.max(1, Math.min(100, value)) })
    }
  },

  onPrintDensityChange(e: any) {
    const value = parseInt(e.detail.value) || 3
    this.setData({ printDensity: Math.max(1, Math.min(9, value)) })
  },

  onPrintSpeedChange(e: any) {
    const value = parseInt(e.detail.value) || 30
    this.setData({ printSpeed: Math.max(15, Math.min(60, value)) })
  },

  onPrintGapChange(e: any) {
    console.log('onPrintGapChange', e)
    // TDesign input 的 change 事件返回 { value: string }
    const inputValue = e.detail?.value !== undefined ? e.detail.value : (e.detail || '')
    const value = parseFloat(String(inputValue))
    if (!isNaN(value) && value >= 0) {
      this.setData({ printGap: Math.max(0, Math.min(8, value)) })
    }
  },

  // 设置旋转角度
  onSetRotate(e: any) {
    const value = parseInt(e.currentTarget.dataset.value) || 1
    this.setData({ printRotate: value })
  },

  // 设置纸张类型
  onSetPaperType(e: any) {
    const value = parseInt(e.currentTarget.dataset.value) || 1
    this.setData({ printPaperType: value })
  },

  // 打印参数弹窗可见性变化
  onPrintSettingsVisibleChange(e: any) {
    this.setData({ printSettingsVisible: e.detail.visible })
  },

  // 确认打印 - 执行实际打印操作（包含保存和上传）
  // 使用默认打印参数，无需用户设置
  async onConfirmPrint() {
    const self = this as any

    // 在打印前再次验证打印机连接状态（保留连接检测逻辑）
    if (self.printManager) {
      const checkResult = self.printManager.canPrint()
      if (!checkResult.canPrint) {
        if (checkResult.message?.includes('未连接打印机')) {
          wx.showModal({
            title: '未连接打印机',
            content: checkResult.message + '，请先连接打印机后再打印',
            showCancel: true,
            confirmText: '去设置',
            cancelText: '取消',
            success: (res) => {
              if (res.confirm) {
                wx.navigateTo({ url: '/pages/settings/settings' })
              }
            }
          })
        } else {
          this.toast(checkResult.message || '无法打印', 'error')
        }
        return
      }
    }

    try {
      this.toast('正在保存并上传...', 'loading')
      
      // 1. 生成合成图片
      const tempFile = await this.getComposedImage()
      
      const openid = this.data.openid || 'unknown'
      const id = this.data.artworkId || Date.now().toString()
      
      // 2. 上传到微信云存储（保存作品）
      this.toast('正在上传到云存储...', 'loading')
      
      const cloudPath = `MaoBi/${openid}/${id}.jpg`
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: cloudPath,
        filePath: tempFile as string
      })
      
      console.log('图片已上传到云存储，fileID:', uploadRes.fileID)
      
      // 3. 获取下载URL（可选，用于后续功能）
      let imageUrl = ''
      try {
        const tempUrlRes = await wx.cloud.getTempFileURL({
          fileList: [uploadRes.fileID]
        })
        if (tempUrlRes.fileList && tempUrlRes.fileList.length > 0 && tempUrlRes.fileList[0].tempFileURL) {
          imageUrl = tempUrlRes.fileList[0].tempFileURL
          console.log('图片已上传到云存储，URL:', imageUrl)
        }
      } catch (urlErr) {
        console.warn('获取下载URL失败，但不影响打印:', urlErr)
      }
      
      // 4. 同时保存到相册（可选，不阻塞打印）
      this.saveToAlbum(tempFile as string).catch(err => {
        console.warn('保存到相册失败', err)
      })
      
      // 5. 使用本地文件路径进行打印（printManager会进行预处理并上传到print_temp路径）
      // 注意：虽然我们已经上传到MaoBi路径保存，但打印需要预处理图片并上传到print_temp路径
      // 所以传入本地文件路径，让printManager进行预处理和上传
      this.toast('正在打印...', 'loading')
      // 传入本地文件路径，printManager会进行预处理并上传到print_temp路径
      await self.printManager.print(tempFile as string, () => Promise.resolve(tempFile))
      
    } catch (error) {
      console.error('打印失败', error)
      this.toast('打印失败', 'error')
      // 错误已在 printManager 中处理
    }
  },
})
