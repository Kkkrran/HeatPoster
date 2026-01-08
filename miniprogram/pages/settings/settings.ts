// 导入打印机SDK
import bleTool from '../../SUPVANAPIT50PRO/BLETool.js'

// --- 接口定义 ---

interface BluetoothDevice {
  deviceId: string
  name?: string
  RSSI?: number
  advertisData?: ArrayBuffer
}

// 存储键名常量
const STORAGE_KEYS = {
  EXIT_CONFIRM: 'editor_exit_confirm',
  MAX_UNDO: 'editor_max_undo_steps'
}

Component({
  data: {
    exitConfirm: true,
    maxUndoSteps: 50,
    limitDialogVisible: false,
    tempLimitValue: '',
    blueList: [],
    connectedDevice: null,
    isScanning: false,
    deviceListVisible: false,
  },

  attached() {
    const self = this as any
    const exitConfirm = wx.getStorageSync(STORAGE_KEYS.EXIT_CONFIRM)
    const maxUndoSteps = wx.getStorageSync(STORAGE_KEYS.MAX_UNDO) || 50
    
    // 加载已保存的打印机连接信息
    const savedDevice = wx.getStorageSync('connected_printer_device')
    if (savedDevice) {
      self.setData({ connectedDevice: savedDevice })
    }
    
    self.setData({ 
      exitConfirm: exitConfirm !== '' ? exitConfirm : true, 
      maxUndoSteps 
    })
  },

  methods: {
    onExitConfirmChange(e: any) {
      const val = e.detail.value
      ;(this as any).setData({ exitConfirm: val })
      wx.setStorageSync(STORAGE_KEYS.EXIT_CONFIRM, val)
    },

    onEditUndoLimit() {
      ;(this as any).setData({
        limitDialogVisible: true,
        tempLimitValue: String((this as any).data.maxUndoSteps)
      })
    },

    onLimitInputChange(e: any) {
      ;(this as any).setData({ tempLimitValue: e.detail.value })
    },

    onLimitCancel() {
      ;(this as any).setData({ limitDialogVisible: false })
    },

    onLimitConfirm() {
      const val = parseInt((this as any).data.tempLimitValue, 10)
      if (isNaN(val) || val < 10 || val > 100) {
        wx.showToast({ title: '请输入10-100之间的整数', icon: 'none' })
        return
      }
      ;(this as any).setData({ 
        maxUndoSteps: val,
        limitDialogVisible: false
      })
      wx.setStorageSync(STORAGE_KEYS.MAX_UNDO, val)
      wx.showToast({ title: '设置成功', icon: 'success' })
    },

    onRequestAlbumAuth() {
      wx.authorize({
        scope: 'scope.writePhotosAlbum',
        success: () => wx.showToast({ title: '授权成功', icon: 'success' }),
        fail: () => (this as any).handlePermissionDenied('相册保存'),
      })
    },

    onOpenSetting() {
      wx.openSetting({})
    },

    onClearCache() {
      wx.showModal({
        title: '清理缓存',
        content: '确定要删除本地生成的临时文件吗？',
        success: (res) => {
          if (res.confirm) {
            const fs = wx.getFileSystemManager()
            try {
              const userDataPath = wx.env.USER_DATA_PATH
              const files = fs.readdirSync(userDataPath)
              let count = 0
              files.forEach(file => {
                // 仅删除常见的临时扩展名，避免误删配置文件
                if (['.json', '.png', '.jpg', '.jpeg'].some(ext => file.endsWith(ext))) {
                  try {
                    fs.unlinkSync(`${userDataPath}/${file}`)
                    count++
                  } catch(e) {}
                }
              })
              wx.showToast({ title: `清理完成(${count})`, icon: 'success' })
            } catch (err) {
              wx.showToast({ title: '清理失败', icon: 'none' })
            }
          }
        }
      })
    },

    onBackHome() {
      wx.navigateBack({ delta: 1 })
    },

    // --- 蓝牙核心逻辑 ---

    async clickStartScanBleDevice() {
      const self = this as any
      
      // 如果正在搜索，则停止搜索
      if (self.data.isScanning) {
        self.clickStopScanBleDevices()
        return
      }

      try {
        // 1. 请求蓝牙权限并初始化蓝牙适配器
        await self.requestBluetoothPermissions()

        // 2. 清空设备列表并开始搜索
        self.data.blueList = []
        self.setData({ 
          blueList: [],
          isScanning: true,
          deviceListVisible: true 
        })

        // 3. 调用SDK扫描蓝牙设备
        // @ts-ignore - SDK回调类型可能不完全匹配
        bleTool.scanBleDeviceList((res: any) => {
          console.log('搜索到的蓝牙设备:', res)
          if (res && res.ResultCode == 0) { // ResultCode 为 0 表示成功
            if (res.ResultValue && res.ResultValue.devices && res.ResultValue.devices[0]) {
              const device = res.ResultValue.devices[0]
              // 检查设备是否已存在，避免重复添加
              if (!self.data.blueList.some((d: BluetoothDevice) => d.deviceId === device.deviceId)) {
                self.data.blueList.push(device)
                self.setData({
                  blueList: self.data.blueList
                })
              }
            }
          }
        }).catch((error: any) => {
          console.error('搜索蓝牙设备失败:', error)
          wx.showToast({ title: '搜索失败', icon: 'none' })
          self.setData({ isScanning: false })
        })
      } catch (error) {
        console.error('蓝牙搜索准备失败', error)
        self.setData({ isScanning: false })
      }
    },

    clickStopScanBleDevices() {
      const self = this as any
      if (typeof bleTool.stopScanBleDevices === 'function') {
        bleTool.stopScanBleDevices().then((res: any) => {
          console.log('停止搜索蓝牙设备成功', res)
          self.setData({ isScanning: false })
          wx.showToast({
            title: '停止搜索',
            icon: 'none'
          })
        }).catch((error: any) => {
          console.error('停止搜索蓝牙设备失败:', error)
          self.setData({ isScanning: false })
        })
      } else {
        self.setData({ isScanning: false })
      }
    },

    clickConnectBleDevice(e: any) {
      const self = this as any
      const device = e.currentTarget.dataset.device
      if (!device) {
        wx.showToast({ title: '设备信息无效', icon: 'none' })
        return
      }

      wx.showLoading({ title: '连接中...', mask: true })
      
      // 如果正在搜索，先停止搜索
      if (self.data.isScanning) {
        self.clickStopScanBleDevices()
      }

      // 连接蓝牙设备
      bleTool.connectBleDevice(device).then((res: any) => {
        console.log('连接蓝牙设备成功', res)
        wx.hideLoading()
        self.setData({ 
          connectedDevice: device,
          deviceListVisible: false 
        })
        // 保存连接信息到本地存储，供 editor 页面使用
        wx.setStorageSync('connected_printer_device', device)
        wx.showToast({
          title: '连接成功',
          icon: 'success'
        })
      }).catch((error: any) => {
        console.error('连接蓝牙设备失败', error)
        wx.hideLoading()
        wx.showToast({
          title: '连接失败',
          icon: 'none'
        })
      })
    },

    clickDisconnectBleDevice() {
      const self = this as any
      if (!self.data.connectedDevice) {
        wx.showToast({ title: '当前未连接设备', icon: 'none' })
        return
      }

      bleTool.disconnectBleDevice().then((res: any) => {
        console.log('断开蓝牙设备成功', res)
        self.setData({ connectedDevice: null })
        // 清除本地存储的连接信息
        wx.removeStorageSync('connected_printer_device')
        wx.showToast({ 
          title: '已断开连接',
          icon: 'success'
        })
      }).catch((error: any) => {
        console.error('断开蓝牙设备失败', error)
        // 即使断开失败，也清除连接状态
        self.setData({ connectedDevice: null })
        wx.showToast({ 
          title: '断开失败',
          icon: 'none'
        })
      })
    },

    onDeviceListVisibleChange(e: any) {
      const self = this as any
      // 当弹窗关闭时，如果正在搜索则停止搜索
      if (!e.detail.visible && self.data.isScanning) {
        self.clickStopScanBleDevices()
      }
      self.setData({ deviceListVisible: e.detail.visible })
    },

    onCloseDeviceList() {
      const self = this as any
      // 如果正在搜索，先停止搜索
      if (self.data.isScanning) {
        self.clickStopScanBleDevices()
      }
      self.setData({ deviceListVisible: false })
    },

    async requestBluetoothPermissions(): Promise<void> {
      const self = this as any
      return new Promise<void>((resolve, reject) => {
        // 1. 初始化蓝牙适配器
        wx.openBluetoothAdapter({
          success: () => {
            console.log('蓝牙适配器初始化成功')
            // 2. 申请蓝牙权限
            wx.authorize({
              scope: 'scope.bluetooth',
              success: () => {
                // Android 额外需要位置权限
                wx.authorize({
                  scope: 'scope.userLocation',
                  success: () => {
                    console.log('权限申请成功')
                    resolve()
                  },
                  fail: () => {
                    console.warn('位置权限申请失败')
                    self.handlePermissionDenied('位置 (扫描蓝牙需要)')
                    reject()
                  }
                })
              },
              fail: () => {
                console.warn('蓝牙权限申请失败')
                self.handlePermissionDenied('蓝牙')
                reject()
              }
            })
          },
          fail: (err: any) => {
            console.error('蓝牙适配器初始化失败', err)
            wx.showModal({
              title: '提示',
              content: '请开启手机蓝牙功能',
              showCancel: false
            })
            reject(err)
          }
        })
      })
    },

    handlePermissionDenied(permissionType: string) {
      wx.showModal({
        title: '提示',
        content: `需要${permissionType}权限，请在设置中开启。`,
        confirmText: '去设置',
        success: (res) => {
          if (res.confirm) wx.openSetting({})
        }
      })
    }
  }
})