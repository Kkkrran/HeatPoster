
Page({
  data: {
    src: '',
    width: 0, // 图片原始宽度
    height: 0, // 图片原始高度
    
    // 裁剪框大小（目标 Canvas 大小）
    cropWidth: 300,
    cropHeight: 400,

    // movable-view 属性
    x: 0,
    y: 0,
    scale: 1,
    rotate: 0,

    // 图片显示大小
    imgWidth: 0,
    imgHeight: 0,

    // 屏幕/容器信息
    containerWidth: 0,
    containerHeight: 0,
  },

  onLoad(_options: any) {
    const eventChannel = this.getOpenerEventChannel()
    eventChannel.on('acceptDataFromOpenerPage', (data: any) => {
      const { src, targetWidth, targetHeight } = data
      
      this.setData({
        src,
        cropWidth: targetWidth || 300,
        cropHeight: targetHeight || 400
      })

      this.initCropper(src)
    })
  },

  initCropper(src: string) {
    const sysInfo = wx.getSystemInfoSync()
    const containerWidth = sysInfo.windowWidth
    // 减去底部 footer 高度，大概估算一下，或者直接获取节点信息
    const containerHeight = sysInfo.windowHeight - 100 // 简单减去底部高度

    this.setData({
      containerWidth,
      containerHeight
    })

    wx.getImageInfo({
      src,
      success: (res) => {
        const { width, height } = res
        
        // 计算图片初始显示大小，使其适应屏幕
        const ratio = Math.min(containerWidth / width, containerHeight / height)
        const imgWidth = width * ratio
        const imgHeight = height * ratio

        // 居中显示
        const x = (containerWidth - imgWidth) / 2
        const y = (containerHeight - imgHeight) / 2

        this.setData({
          width,
          height,
          imgWidth,
          imgHeight,
          x,
          y,
          scale: 1,
          rotate: 0
        })
      }
    })
  },

  onChange(e: any) {
    const { x, y } = e.detail
    this.setData({ x, y })
  },

  onScale(e: any) {
    const { scale, x, y } = e.detail
    this.setData({ scale, x, y })
  },

  onRotate() {
    this.setData({
      rotate: (this.data.rotate + 90) % 360
    })
  },

  onConfirm() {
    wx.showLoading({ title: '处理中...' })
    const query = this.createSelectorQuery()
    query.select('#cropCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        const canvas = res[0].node
        const ctx = canvas.getContext('2d')

        const dpr = wx.getSystemInfoSync().pixelRatio
        canvas.width = this.data.cropWidth * dpr
        canvas.height = this.data.cropHeight * dpr
        ctx.scale(dpr, dpr)

        // 绘制逻辑：
        // 我们需要计算图片在 cropBox 中的相对位置
        // 1. 获取 cropBox 在页面中的位置 (居中)
        // 2. 获取 movable-view (图片) 在页面中的位置 (x, y, scale)
        // 3. 计算相对偏移

        // 简单起见，我们假设 cropBox 是绝对居中的
        // 实际上，我们在 wxss 中使用了 flex center，所以 cropBox 是居中的
        // 但是 mask-middle 的高度是 cropHeight，所以 cropBox 的 top 是 (containerHeight - cropHeight) / 2
        // cropBox 的 left 是 (containerWidth - cropWidth) / 2
        
        const cropLeft = (this.data.containerWidth - this.data.cropWidth) / 2
        const cropTop = (this.data.containerHeight - this.data.cropHeight) / 2

        // 图片当前的实际位置和大小
        // movable-view 的 x, y 是相对于 movable-area 左上角的
        // scale 是以 movable-view 中心为基准吗？ movable-view 的 scale 行为比较复杂
        // 通常 movable-view 的 x,y 是指 view 左上角的坐标（在 scale 之后？）
        // 不，movable-view 的 x,y 是 transform 之前的坐标，scale 是 transform
        
        // 让我们换一种思路：
        // 我们已知图片显示的 imgWidth, imgHeight, x, y, scale, rotate
        // 我们要画到 canvas 上，canvas 大小为 cropWidth * cropHeight
        
        // Canvas 坐标系原点 (0,0) 对应 cropBox 左上角
        // 图片在 Canvas 坐标系中的位置：
        // imgX_in_canvas = x - cropLeft
        // imgY_in_canvas = y - cropTop
        
        // 还需要考虑 scale 和 rotate
        // 旋转中心通常是图片中心
        
        const imgCenterX = this.data.x + this.data.imgWidth / 2
        const imgCenterY = this.data.y + this.data.imgHeight / 2
        
        const imgCenterX_in_canvas = imgCenterX - cropLeft
        const imgCenterY_in_canvas = imgCenterY - cropTop

        const img = canvas.createImage()
        img.src = this.data.src
        img.onload = () => {
          ctx.save()
          
          // 移动到图片中心
          ctx.translate(imgCenterX_in_canvas, imgCenterY_in_canvas)
          
          // 缩放
          ctx.scale(this.data.scale, this.data.scale)
          
          // 旋转
          ctx.rotate(this.data.rotate * Math.PI / 180)
          
          // 绘制图片 (以中心为原点)
          ctx.drawImage(
            img, 
            -this.data.imgWidth / 2, 
            -this.data.imgHeight / 2, 
            this.data.imgWidth, 
            this.data.imgHeight
          )
          
          ctx.restore()

          // 导出
          wx.canvasToTempFilePath({
            canvas,
            success: (res) => {
              wx.hideLoading()
              const eventChannel = this.getOpenerEventChannel()
              eventChannel.emit('acceptDataFromCropper', {
                tempFilePath: res.tempFilePath
              })
              wx.navigateBack()
            },
            fail: (err) => {
              console.error(err)
              wx.hideLoading()
              wx.showToast({ title: '生成失败', icon: 'none' })
            }
          })
        }
      })
  }
})
