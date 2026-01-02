// miniprogram/pages/editor/editor.ts

// 定义笔触点结构
interface HeatPoint {
  x: number
  y: number
  r: number
  opacity: number
}

// 定义笔画结构
type Stroke = HeatPoint[]

Component({
  properties: {
    artworkId: {
      type: String,
      value: ''
    }
  },

  data: {
    toolsVisible: false,
    brushRadius: 40,
    heatRate: 0.6,
    canRedo: false,
    canUndo: false,
    openid: '',
    snapshotUrl: '',
    isCanvasHidden: false,
    backgroundImage: '',
  },

  lifetimes: {
    attached() {
      // 初始化实例变量
      Object.assign(this, {
        canvas: null,
        ctx: null,
        memCanvas: null,
        memCtx: null,
        palette: null,
        dpr: 1,
        width: 0,
        height: 0,
        strokes: [],
        redoStack: [],
        currentStroke: [],
        needsRender: false,
        renderLoopId: 0
      })
      this.initCanvas()
      this.getOpenId()
    },
    detached() {
      const self = this as any
      if (self.renderLoopId) {
        self.canvas.cancelAnimationFrame(self.renderLoopId)
      }
    },
  },

  methods: {
    onLoad(options: any) {
      if (options && options.id) {
        this.setData({ artworkId: options.id })
        this.loadArtwork(options.id)
      }
    },

    async getOpenId() {
      try {
        const res = await wx.cloud.callFunction({
          name: 'editor',
          data: { action: 'getOpenId' }
        })
        const result = res.result as any
        if (!result.ok) {
          console.error('getOpenId cloud error:', result)
          return
        }
        const openid = result.data.openid
        this.setData({ openid })
      } catch (e) {
        console.error('getOpenId failed', e)
      }
    },

    toast(message: string, theme: 'success' | 'error' | 'warning' | 'loading' | 'info' = 'info') {
      const toast = this.selectComponent('#t-toast') as any
      if (!toast || typeof toast.show !== 'function') return
      toast.show({
        theme,
        direction: 'column',
        message,
        duration: 1800,
      })
    },

    initCanvas() {
      const query = this.createSelectorQuery()
      query.select('#paintCanvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          if (!res[0] || !res[0].node) return
          const canvas = res[0].node
          const ctx = canvas.getContext('2d')
          // @ts-ignore
          const dpr = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).pixelRatio
          
          const self = this as any
          self.canvas = canvas
          self.ctx = ctx
          self.dpr = dpr
          self.width = res[0].width
          self.height = res[0].height

          canvas.width = res[0].width * dpr
          canvas.height = res[0].height * dpr
          ctx.scale(dpr, dpr)

          // 初始化离屏 Canvas
          // @ts-ignore
          self.memCanvas = wx.createOffscreenCanvas({ type: '2d', width: canvas.width, height: canvas.height })
          self.memCtx = self.memCanvas.getContext('2d')

          this.initPalette()
          this.startRenderLoop()
        })
    },

    initPalette() {
      // @ts-ignore
      const pCanvas = wx.createOffscreenCanvas({ type: '2d', width: 256, height: 1 })
      const pCtx = pCanvas.getContext('2d')
      
      const grad = pCtx.createLinearGradient(0, 0, 256, 0)
      grad.addColorStop(0.0, "rgba(0,0,0,0)")
      grad.addColorStop(0.2, "rgba(0,0,255,0.2)")
      grad.addColorStop(0.3, "rgba(43,111,231,0.3)")
      grad.addColorStop(0.4, "rgba(2,192,241,0.4)")
      grad.addColorStop(0.6, "rgba(44,222,148,0.6)")
      grad.addColorStop(0.8, "rgba(254,237,83,0.8)")
      grad.addColorStop(0.9, "rgba(255,118,50,0.9)")
      grad.addColorStop(1.0, "rgba(255,10,0,0.95)")
      
      pCtx.fillStyle = grad
      pCtx.fillRect(0, 0, 256, 1)
      
      const imageData = pCtx.getImageData(0, 0, 256, 1)
      const self = this as any
      self.palette = imageData.data
    },

    startRenderLoop() {
      const self = this as any
      const loop = () => {
        if (self.needsRender) {
          this.render()
          self.needsRender = false
        }
        self.renderLoopId = self.canvas.requestAnimationFrame(loop)
      }
      self.renderLoopId = self.canvas.requestAnimationFrame(loop)
    },

    onTouchStart(e: any) {
      const { x, y } = e.touches[0]
      const self = this as any
      self.currentStroke = []
      this.addPoint(x, y)
    },

    onTouchMove(e: any) {
      const { x, y } = e.touches[0]
      this.addPoint(x, y)
    },

    onTouchEnd(_e: any) {
      const self = this as any
      if (self.currentStroke.length > 0) {
        self.strokes.push(self.currentStroke)
        self.redoStack = []
        this.setData({ 
          canUndo: true,
          canRedo: false
        })
        self.currentStroke = []
      }
    },

    addPoint(x: number, y: number) {
      const self = this as any
      if (!self.memCtx) return
      const point: HeatPoint = {
        x,
        y,
        r: this.data.brushRadius,
        opacity: 0.05 * this.data.heatRate
      }
      self.currentStroke.push(point)
      this.drawAlphaPoint(point)
      self.needsRender = true
    },

    drawAlphaPoint(p: HeatPoint) {
      const self = this as any
      const ctx = self.memCtx
      const dpr = self.dpr
      const cx = p.x * dpr
      const cy = p.y * dpr
      const r = p.r * dpr
      
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
      grad.addColorStop(0, `rgba(0,0,0,${p.opacity})`)
      grad.addColorStop(1, "rgba(0,0,0,0)")
      
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, 2 * Math.PI)
      ctx.fill()
    },

    render() {
      const self = this as any
      if (!self.palette || !self.memCtx || !self.ctx) return
      
      const w = self.memCanvas.width
      const h = self.memCanvas.height
      
      const imageData = self.memCtx.getImageData(0, 0, w, h)
      const data = imageData.data
      const palette = self.palette
      
      for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3]
        if (alpha > 0) {
          const offset = alpha * 4
          data[i] = palette[offset]
          data[i + 1] = palette[offset + 1]
          data[i + 2] = palette[offset + 2]
          data[i + 3] = palette[offset + 3]
        }
      }
      
      self.ctx.putImageData(imageData, 0, 0)
    },

    redrawAll() {
      const self = this as any
      if (!self.memCtx) return
      self.memCtx.clearRect(0, 0, self.memCanvas.width, self.memCanvas.height)
      
      for (const stroke of self.strokes) {
        for (const p of stroke) {
          this.drawAlphaPoint(p)
        }
      }
      
      self.needsRender = true
    },

    openTools() {
      const self = this as any
      // 生成快照以解决原生 Canvas 遮挡 Popup 的问题
      wx.canvasToTempFilePath({
        canvas: self.canvas,
        fileType: 'png',
        quality: 0.8,
        success: (res) => {
          this.setData({
            snapshotUrl: res.tempFilePath,
            isCanvasHidden: true,
            toolsVisible: true
          })
        },
        fail: (err) => {
          console.error('snapshot failed', err)
          // 降级处理：直接打开，虽然可能会遮挡
          this.setData({ toolsVisible: true })
        }
      })
    },

    closeTools() {
      this.setData({ 
        toolsVisible: false,
        isCanvasHidden: false
      })
    },

    onToolsVisibleChange(e: any) {
      const { visible } = e.detail || {}
      this.setData({ 
        toolsVisible: !!visible,
        // 当弹窗关闭（点击遮罩层）时，也要恢复 Canvas 显示
        isCanvasHidden: !!visible 
      })
    },

    onBrushRadiusChange(e: any) {
      console.log('onBrushRadiusChange', e)
      const v = Number(e.detail?.value ?? 18)
      this.setData({ brushRadius: v })
    },

    onHeatRateChange(e: any) {
      console.log('onHeatRateChange', e)
      const v = Number(e.detail?.value ?? 1.0)
      this.setData({ heatRate: v })
    },

    onUndo() {
      const self = this as any
      if (self.strokes.length === 0) return
      const stroke = self.strokes.pop()
      if (stroke) {
        self.redoStack.push(stroke)
        this.setData({ 
          canUndo: self.strokes.length > 0,
          canRedo: true 
        })
        this.redrawAll()
        this.toast('已撤回')
      }
    },

    onRedo() {
      const self = this as any
      if (self.redoStack.length === 0) return
      const stroke = self.redoStack.pop()
      if (stroke) {
        self.strokes.push(stroke)
        this.setData({ 
          canUndo: true,
          canRedo: self.redoStack.length > 0 
        })
        for (const p of stroke) {
          this.drawAlphaPoint(p)
        }
        self.needsRender = true
        this.toast('已重做')
      }
    },

    onClear() {
      const self = this as any
      self.strokes = []
      self.redoStack = []
      this.setData({ canUndo: false, canRedo: false })
      this.redrawAll()
      this.toast('画布已清空')
    },

    async onSave() {
      const self = this as any
      if (self.strokes.length === 0) {
        this.toast('画布为空', 'warning')
        return
      }
      
      this.toast('正在保存...', 'loading')
      
      try {
        const strokesData = JSON.stringify(self.strokes)
        const fs = wx.getFileSystemManager()
        const pointsPath = `${wx.env.USER_DATA_PATH}/${Date.now()}_points.json`
        fs.writeFileSync(pointsPath, strokesData, 'utf8')

        const openid = this.data.openid || 'unknown'
        const { fileID: pointsFileId } = await wx.cloud.uploadFile({
          cloudPath: `artworks/${openid}/${Date.now()}_points.json`,
          filePath: pointsPath
        })
        
        const { tempFilePath } = await wx.canvasToTempFilePath({
          canvas: self.canvas,
          fileType: 'png',
          quality: 0.8
        })
        
        const { fileID: thumbnailFileId } = await wx.cloud.uploadFile({
          cloudPath: `artworks/${openid}/${Date.now()}_thumb.png`,
          filePath: tempFilePath
        })
        
        let id = this.data.artworkId
        if (!id) {
           const res = await wx.cloud.callFunction({
             name: 'editor',
             data: { 
               action: 'create',
               name: '未命名作品',
               width: self.width,
               height: self.height
             }
           })
           // @ts-ignore
           id = res.result.data.id
           this.setData({ artworkId: id })
        }
        
        await wx.cloud.callFunction({
          name: 'editor',
          data: {
            action: 'savePoints',
            id,
            pointsFileId,
            thumbnailFileId
          }
        })
        
        this.toast('保存成功', 'success')
        
      } catch (err) {
        console.error(err)
        this.toast('保存失败', 'error')
      }
    },
    
    async loadArtwork(id: string) {
      const self = this as any
      this.toast('加载中...', 'loading')
      try {
        const res = await wx.cloud.callFunction({
          name: 'editor',
          data: { action: 'get', id }
        })
        // @ts-ignore
        const data = res.result.data
        if (data && data.pointsFileId) {
          const downloadRes = await wx.cloud.downloadFile({ fileID: data.pointsFileId })
          const fs = wx.getFileSystemManager()
          const jsonStr = fs.readFileSync(downloadRes.tempFilePath, 'utf8')
          const strokes = JSON.parse(jsonStr as string)
          
          self.strokes = strokes
          this.redrawAll()
          this.setData({ canUndo: true })
        }
        this.toast('加载完成', 'success')
      } catch (err) {
        console.error(err)
        this.toast('加载失败', 'error')
      }
    },

    onImportBackground() {
      const self = this as any
      wx.chooseImage({
        count: 1,
        sizeType: ['original', 'compressed'],
        sourceType: ['album', 'camera'],
        success(res) {
          const tempFilePaths = res.tempFilePaths
          if (tempFilePaths.length > 0) {
            const src = tempFilePaths[0]
            
            // 获取 Canvas 大小
            const query = self.createSelectorQuery()
            query.select('#paintCanvas')
              .fields({ node: true, size: true })
              .exec((res: any) => {
                const width = res[0].width
                const height = res[0].height
                
                wx.navigateTo({
                  url: '/pages/cropper/cropper',
                  events: {
                    acceptDataFromCropper: function(data: any) {
                      self.setData({
                        backgroundImage: data.tempFilePath,
                        // 关闭工具面板，以便查看背景
                        toolsVisible: false,
                        isCanvasHidden: false
                      })
                    }
                  },
                  success: function(res) {
                    res.eventChannel.emit('acceptDataFromOpenerPage', { 
                      src: src,
                      targetWidth: width,
                      targetHeight: height
                    })
                  }
                })
              })
          }
        }
      })
    },
  },
})
