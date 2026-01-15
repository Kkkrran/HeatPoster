const cloud = require('wx-server-sdk')
const COS = require('cos-nodejs-sdk-v5')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// 必须在云函数配置中添加环境变量: TENCENT_SECRET_ID, TENCENT_SECRET_KEY
const { TENCENT_SECRET_ID, TENCENT_SECRET_KEY } = process.env

// COS 配置
const BUCKET = 'print-1393918820'
const REGION = 'ap-guangzhou'
const COS_HOST = `${BUCKET}.cos.${REGION}.myqcloud.com`

exports.main = async (event, context) => {
  const { fileName, prefix } = event
  const { OPENID } = cloud.getWXContext()

  if (!TENCENT_SECRET_ID || !TENCENT_SECRET_KEY) {
    return { error: '请在云函数配置中设置环境变量: TENCENT_SECRET_ID, TENCENT_SECRET_KEY' }
  }

  // 1. 生成存储路径
  // 如果调用方传递了 prefix（如毛笔模块），则使用自定义前缀，否则使用默认的 print_temp
  // 使用时间戳防止文件名冲突
  let key
  if (prefix) {
     // 去掉首尾斜杠防止双斜杠
     const cleanPrefix = prefix.replace(/\/$/, '')
     key = `${cleanPrefix}/${fileName || Date.now() + '.jpg'}`
  } else {
     key = `print_temp/${OPENID}/${Date.now()}_${fileName || 'print.jpg'}`
  }

  // 2. 初始化 COS SDK (用于生成下载链接)
  const cos = new COS({
    SecretId: TENCENT_SECRET_ID,
    SecretKey: TENCENT_SECRET_KEY
  })

  try {
    // 3. 生成 POST 上传所需的表单字段 (Signature, Policy)
    // 这种方式支持 wx.uploadFile，无需将文件读入内存
    
    // 过期时间：5分钟
    const exp = Date.now() + 300000
    const qKeyTime = Math.floor(Date.now() / 1000) + ';' + Math.floor(exp / 1000)
    const qSignAlgorithm = 'sha1'
    
    // 策略 Policy
    const policy = JSON.stringify({
      expiration: new Date(exp).toISOString(),
      conditions: [
        { 'q-sign-algorithm': qSignAlgorithm },
        { 'q-ak': TENCENT_SECRET_ID },
        { 'q-sign-time': qKeyTime },
        { 'bucket': BUCKET },
        { 'key': key }
      ]
    })
    
    // 计算签名
    const signKey = crypto.createHmac('sha1', TENCENT_SECRET_KEY).update(qKeyTime).digest('hex')
    const stringToSign = crypto.createHash('sha1').update(policy).digest('hex')
    const signature = crypto.createHmac('sha1', signKey).update(stringToSign).digest('hex')

    const formData = {
      'key': key,
      'policy': Buffer.from(policy).toString('base64'),
      'q-sign-algorithm': qSignAlgorithm,
      'q-ak': TENCENT_SECRET_ID,
      'q-key-time': qKeyTime,
      'q-signature': signature
    }

    // 4. 生成带签名的下载链接 (GET Url)
    // 有效期 1 小时，供打印机使用
    const downloadUrl = await new Promise((resolve, reject) => {
      cos.getObjectUrl({
        Bucket: BUCKET,
        Region: REGION,
        Key: key,
        Sign: true,
        Expires: 3600
      }, (err, data) => {
        if (err) reject(err)
        else resolve(data.Url)
      })
    })

    return {
      success: true,
      uploadUrl: `https://${COS_HOST}`, // POST 目标地址
      formData: formData,                // POST 表单数据
      downloadUrl: downloadUrl,          // 最终可访问的 URL
      key: key
    }

  } catch (err) {
    console.error('COS Auth Error:', err)
    return { error: err.message }
  }
}
