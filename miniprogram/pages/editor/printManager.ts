// 打印管理模块
// 将打印相关逻辑从 editor.ts 中拆分出来

import bleToothManage from '../../SUPVANAPIT50PRO/BLEToothManage.js'
import constants from '../../SUPVANAPIT50PRO/Constants.js'

// 打印参数接口
export interface PrintSettings {
  printWidth: number
  printHeight: number
  printCopies: number
  printDensity: number
  printSpeed: number
  printRotate: number
  printPaperType: number
  printGap: number
}

// 默认打印参数（严格按照SDK文档2.1节）
export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  printWidth: 70,      // 耗材宽度（mm）
  printHeight: 100,     // 耗材高度（mm）
  printRotate: 1,      // 旋转角度（1=0度，2=90度），默认1
  printCopies: 1,      // 打印份数（1-99），默认1
  printDensity: 3,     // 浓度（1-9），默认3
  printSpeed: 30,      // 打印速度（15-60），默认30
  printPaperType: 1,   // 纸张类型（1-间隙，2-普通黑标，3-连续，5-黑标卡纸），默认1
  printGap: 3,         // 纸张间隙（mm，范围0-8），默认3
}

// 打印管理器类
export class PrintManager {
  private page: any // Page 实例

  constructor(page: any) {
    this.page = page
  }

  // 检查打印机连接状态
  checkPrinterConnection() {
    const savedDevice = wx.getStorageSync('connected_printer_device')
    if (savedDevice) {
      this.page.setData({ connectedDevice: savedDevice })
    } else {
      this.page.setData({ connectedDevice: null })
    }
  }

  // 初始化打印Canvas（与SDK示例保持一致）
  initPrintCanvas() {
    try {
      // 使用 createCanvasContext 创建传统 Canvas 上下文（与 SDK 示例保持一致）
      // 示例中使用 canvas-id="Canvas"
      const ctx = wx.createCanvasContext('Canvas', this.page)
      const barCode = wx.createSelectorQuery().in(this.page)
      if (ctx) {
        this.page.setData({ 
          canvasText: ctx,
          canvasBarCode: barCode
        })
        console.log('打印Canvas初始化成功')
      }
    } catch (error) {
      console.error('打印Canvas初始化失败:', error)
    }
  }

  // 加载打印参数（始终使用默认值，不保存到本地）
  loadPrintSettings(): PrintSettings {
    const defaultSettings = DEFAULT_PRINT_SETTINGS
    this.page.setData(defaultSettings)
    return defaultSettings
  }

  // 保存打印参数（不再保存到本地，仅用于兼容性）
  savePrintSettings(_settings: PrintSettings) {
    // 不再保存到本地存储，参数仅在当前会话中有效
  }

  // 检查是否可以打印
  canPrint(): { canPrint: boolean; message?: string } {
    // 检查是否已连接打印机
    if (!this.page.data.connectedDevice) {
      return {
        canPrint: false,
        message: '未连接打印机，请在设置界面连接'
      }
    }

    // 检查画布是否有内容
    const self = this.page as any
    if (!self.strokes || self.strokes.length === 0) {
      return {
        canPrint: false,
        message: '画布为空，无法打印'
      }
    }

    // 检查Canvas是否初始化
    if (!this.page.data.canvasText) {
      return {
        canPrint: false,
        message: '打印Canvas未初始化'
      }
    }

    return { canPrint: true }
  }

  // 上传图片到云存储并获取网络URL
  async uploadImageToCloud(localPath: string, openid: string): Promise<string> {
    console.log('检测到本地路径，上传到云存储获取网络URL...')
    this.page.toast('正在上传图片...', 'loading')
    
    try {
      const timestamp = Date.now()
      const cloudPath = `print_temp/${openid}/${timestamp}_print.png`
      
      // 上传到云存储
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: cloudPath,
        filePath: localPath
      })
      
      console.log('上传成功，fileID:', uploadRes.fileID)
      
      // 获取临时下载URL（https://开头）
      const tempUrlRes = await wx.cloud.getTempFileURL({
        fileList: [uploadRes.fileID]
      })
      
      if (tempUrlRes.fileList && tempUrlRes.fileList.length > 0 && tempUrlRes.fileList[0].tempFileURL) {
        const imageUrl = tempUrlRes.fileList[0].tempFileURL
        console.log('获取到网络URL:', imageUrl)
        
        // 验证网络URL是否可以访问（等待更长时间确保URL完全生效）
        try {
          // 等待更长时间，确保云存储URL完全生效
          await new Promise((resolve) => setTimeout(resolve, 1000)) // 等待1秒
          
          // 尝试获取图片信息，验证URL可访问
          const urlImageInfo = await new Promise<WechatMiniprogram.GetImageInfoSuccessCallbackResult>((resolve, reject) => {
            wx.getImageInfo({
              src: imageUrl,
              success: resolve,
              fail: reject,
            })
          })
          console.log('网络URL验证成功:', {
            url: imageUrl,
            width: urlImageInfo.width,
            height: urlImageInfo.height
          })
          
          // 再次等待，确保SDK可以访问
          await new Promise((resolve) => setTimeout(resolve, 500))
        } catch (urlErr) {
          console.warn('网络URL验证失败，但继续尝试:', urlErr)
          // 不阻止打印，继续尝试
        }
        
        return imageUrl
      } else {
        throw new Error('无法获取临时下载URL')
      }
    } catch (uploadErr) {
      console.error('上传到云存储失败:', uploadErr)
      throw uploadErr
    }
  }

  // 预处理图片：将图片缩放/裁剪到匹配打印纸张的尺寸和宽高比
  async preprocessImageForPrint(
    imagePath: string, 
    targetWidth: number, 
    targetHeight: number
  ): Promise<string> {
    // 获取原始图片信息
    const imageInfo = await this.validateImagePath(imagePath)
    const sourceWidth = imageInfo.width
    const sourceHeight = imageInfo.height
    const sourceAspectRatio = sourceWidth / sourceHeight
    const targetAspectRatio = targetWidth / targetHeight
    
    // 如果宽高比已经匹配，直接返回原图
    if (Math.abs(sourceAspectRatio - targetAspectRatio) < 0.01) {
      console.log('图片宽高比已匹配，无需预处理')
      return imagePath
    }
    
    // 计算目标像素尺寸
    // 根据 SDK 文档，ImageWidth 和 ImageHeight 是预览图尺寸（mm）
    // SDK 会根据这个尺寸来缩放图片，所以我们需要确保图片的宽高比匹配
    // 使用较高的分辨率来保持图片质量，SDK 会自动缩放
    // 从调试信息看，SDK 内部使用 8 像素/mm，但我们使用更高分辨率以保持质量
    const pixelsPerMm = 8  // 与 SDK 内部处理一致
    const targetPixelWidth = Math.round(targetWidth * pixelsPerMm)
    const targetPixelHeight = Math.round(targetHeight * pixelsPerMm)
    
    console.log('预处理图片:', {
      原始尺寸: `${sourceWidth}x${sourceHeight}`,
      原始宽高比: sourceAspectRatio.toFixed(3),
      目标尺寸: `${targetWidth}x${targetHeight}mm`,
      目标像素: `${targetPixelWidth}x${targetPixelHeight}`,
      目标宽高比: targetAspectRatio.toFixed(3)
    })
    
    // 创建离屏 Canvas 进行图片处理
    // @ts-ignore
    const offscreenCanvas = wx.createOffscreenCanvas({ 
      type: '2d', 
      width: targetPixelWidth, 
      height: targetPixelHeight 
    })
    const ctx = offscreenCanvas.getContext('2d')
    
    // 填充白色背景
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, targetPixelWidth, targetPixelHeight)
    
    // 加载并绘制图片（保持宽高比，居中显示）
    // @ts-ignore
    const img = offscreenCanvas.createImage()
    img.src = imagePath
    
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = reject
    })
    
    // 直接将图片拉伸到目标尺寸（不保持宽高比，填满整个画布）
    // 根据 SDK 文档，ImageWidth 和 ImageHeight 应该等于 Width 和 Height（纸张尺寸）
    // 所以预处理后的图片应该完全匹配纸张尺寸，避免 SDK 缩放时出现问题
    ctx.drawImage(img, 0, 0, targetPixelWidth, targetPixelHeight)
    
    // 导出处理后的图片
    return new Promise((resolve, reject) => {
      wx.canvasToTempFilePath({
        canvas: offscreenCanvas,
        fileType: 'png',
        quality: 1,
        success: (res) => {
          console.log('图片预处理完成:', res.tempFilePath)
          resolve(res.tempFilePath)
        },
        fail: reject
      })
    })
  }

  // 验证图片路径
  async validateImagePath(imagePath: string): Promise<WechatMiniprogram.GetImageInfoSuccessCallbackResult> {
    // 验证图片路径是否存在
    if (!imagePath) {
      throw new Error('生成图片失败：路径为空')
    }
    
    // 获取图片信息，验证图片是否有效
    const imageInfo = await new Promise<WechatMiniprogram.GetImageInfoSuccessCallbackResult>((resolve, reject) => {
      wx.getImageInfo({
        src: imagePath,
        success: resolve,
        fail: reject,
      })
    })
    
    console.log('图片信息:', {
      path: imagePath,
      width: imageInfo.width,
      height: imageInfo.height,
      type: imageInfo.type
    })
    
    // 验证文件是否存在（通过文件系统管理器）
    try {
      const fs = wx.getFileSystemManager()
      fs.accessSync(imagePath)
      console.log('文件存在验证通过:', imagePath)
    } catch (fsErr) {
      console.error('文件不存在或无法访问:', fsErr)
      console.warn('文件系统验证失败，但继续尝试打印')
    }
    
    return imageInfo
  }

  // 构建打印参数对象（严格按照 SDK 文档格式）
  buildPageImageObject(settings: PrintSettings, imageUrl: string, imageInfo?: WechatMiniprogram.GetImageInfoSuccessCallbackResult): any[] {
    // 根据文档，Rotate 应该是 1 或 2（1=0度，2=90度）
    let rotateValue = settings.printRotate
    if (rotateValue !== 1 && rotateValue !== 2) {
      // 如果值不在1-2范围内，转换为1或2
      rotateValue = rotateValue <= 2 ? rotateValue : 1
    }
    
    // 根据 SDK 文档：
    // - Width/Height: 耗材尺寸（纸张尺寸，单位mm）
    // - ImageWidth/ImageHeight: 预览图图片尺寸（单位mm），应该等于图片的实际物理尺寸
    // 图片已经预处理过，宽高比已匹配纸张，所以 ImageWidth 和 ImageHeight 应该等于纸张尺寸
    const imageWidth = settings.printWidth
    const imageHeight = settings.printHeight
    
    if (imageInfo) {
      const imagePixelWidth = imageInfo.width
      const imagePixelHeight = imageInfo.height
      const imageAspectRatio = imagePixelWidth / imagePixelHeight
      const paperAspectRatio = settings.printWidth / settings.printHeight
      
      console.log('打印参数构建（按SDK文档）:', {
        图片像素: `${imagePixelWidth}x${imagePixelHeight}`,
        图片宽高比: imageAspectRatio.toFixed(3),
        纸张尺寸: `${settings.printWidth}x${settings.printHeight}mm`,
        纸张宽高比: paperAspectRatio.toFixed(3),
        ImageWidth: `${imageWidth}mm (预览图宽度)`,
        ImageHeight: `${imageHeight}mm (预览图高度)`,
        宽高比匹配: Math.abs(imageAspectRatio - paperAspectRatio) < 0.01 ? '是' : '否'
      })
    }
    
    // 严格按照 SDK 文档格式：PageImageObject
    return [{
      "Width": settings.printWidth,        // 耗材宽度（mm）
      "Height": settings.printHeight,       // 耗材高度（mm）
      "Rotate": rotateValue,                // 旋转角度（1=0度，2=90度）
      "Copies": settings.printCopies,       // 打印份数
      "Density": settings.printDensity,     // 浓度（1-9）
      "HorizontalNum": 0,                   // 水平偏移（mm）
      "VerticalNum": 0,                     // 垂直偏移（mm）
      "PaperType": settings.printPaperType, // 纸张类型
      "Gap": settings.printGap,            // 纸张间隙（mm）
      "DeviceSn": 'T0033A2512096269', // 蓝牙序列号
      "ImageUrl": imageUrl,                 // 打印图片地址（https开头）
      "ImageWidth": imageWidth,             // 预览图图片宽（mm）
      "ImageHeight": imageHeight,           // 预览图图片高（mm）
      "Speed": settings.printSpeed,          // 打印速度
    }]
  }

  // 执行打印
  async print(imagePath: string, getComposedImagePath: () => Promise<string>): Promise<void> {
    // 检查是否可以打印
    const checkResult = this.canPrint()
    if (!checkResult.canPrint) {
      this.page.toast(checkResult.message || '无法打印', 'error')
      return
    }

    // 获取当前打印参数
    const settings: PrintSettings = {
      printWidth: this.page.data.printWidth,
      printHeight: this.page.data.printHeight,
      printCopies: this.page.data.printCopies,
      printDensity: this.page.data.printDensity,
      printSpeed: this.page.data.printSpeed,
      printRotate: this.page.data.printRotate,
      printPaperType: this.page.data.printPaperType,
      printGap: this.page.data.printGap,
    }

    // 不再保存参数到本地存储

    try {
      this.page.toast('正在生成图片...', 'loading')
      
      // 生成合成图片（如果 imagePath 为空，则调用 getComposedImagePath）
      let composedPath = imagePath || await getComposedImagePath()
      
      // 验证图片路径
      await this.validateImagePath(composedPath)
      
      // 预处理图片：将图片调整为匹配打印纸张的尺寸和宽高比
      // SDK 会根据 Width 和 Height 来缩放图片，所以我们需要提前调整图片宽高比
      const processedPath = await this.preprocessImageForPrint(
        composedPath,
        settings.printWidth,
        settings.printHeight
      )
      
      // 重新获取处理后的图片信息
      const processedImageInfo = await this.validateImagePath(processedPath)
      
      // 处理图片URL（如果是本地路径，上传到云存储）
      let finalImageUrl = processedPath
      const isNetworkUrl = finalImageUrl.startsWith('http://') || finalImageUrl.startsWith('https://')
      
      if (!isNetworkUrl) {
        const openid = this.page.data.openid || 'unknown'
        finalImageUrl = await this.uploadImageToCloud(processedPath, openid)
      } else {
        console.log('使用网络URL:', finalImageUrl)
      }
      
      // 构建打印参数（使用处理后的图片信息，ImageWidth 和 ImageHeight 应该等于纸张尺寸）
      const PageImageObject = this.buildPageImageObject(settings, finalImageUrl, processedImageInfo)
      
      this.page.toast('正在打印...', 'loading')
      
      // 打印前检查参数
      console.log('打印参数:', JSON.stringify(PageImageObject, null, 2))
      console.log('图片URL:', finalImageUrl)
      console.log('原始路径:', composedPath)
      
      // 验证canvas上下文是否存在
      if (!this.page.data.canvasText) {
        console.error('Canvas上下文不存在，重新初始化...')
        this.initPrintCanvas()
        if (!this.page.data.canvasText) {
          this.page.toast('Canvas初始化失败', 'error')
          return
        }
      }
      console.log('Canvas上下文验证通过')
      
      // 调用打印SDK（严格按照SDK文档3.11节）
      return new Promise((resolve, reject) => {
        bleToothManage.doPrintImage(this.page.data.canvasText, PageImageObject, (res: any) => {
          console.log('打印图片回调', res)
          if (res.ResultCode == 100) {
            // 打印进度回调（SDK文档3.11节：返回画布尺寸信息）
            let resultValue = res.ResultValue
            console.log('打印尺寸:', resultValue.width, resultValue.height)
            // 更新 Canvas 尺寸（SDK文档3.11节）
            this.page.setData({
              templateWidth: resultValue.width || 400,
              templateHeight: resultValue.height || 240,
            })
          } else if (res.ResultCode == constants.globalResultCode.ResultCodeSuccess) {
            // 打印完成
            this.page.toast('打印完成', 'success')
            resolve()
          } else {
            // 打印失败，显示详细错误信息
            const errorMsg = res.ErrorMsg?.ErrMsg || res.ErrorMsg || `错误码: ${res.ResultCode}`
            console.error('打印失败详情:', {
              ResultCode: res.ResultCode,
              ErrorMsg: res.ErrorMsg,
              ResultValue: res.ResultValue
            })
            this.page.toast(`打印失败: ${errorMsg}`, 'error')
            reject(new Error(errorMsg))
          }
        }).catch((error: any) => {
          console.log('打印图片失败', error)
          const errorMsg = error?.ErrorMsg?.ErrMsg || error?.message || '未知错误'
          this.page.toast(`打印失败: ${errorMsg}`, 'error')
          reject(error)
        })
      })
    } catch (error) {
      console.error('生成图片失败', error)
      this.page.toast('生成图片失败', 'error')
      throw error
    }
  }
}
