// 云函数：编辑器存取（作品数据、points JSON fileID）
// action: create | get | savePoints
// 说明：图片上传（uploadFile）必须在小程序端做，云函数负责写 DB。

const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const COLLECTION = 'artworks'

const pickString = v => (typeof v === 'string' ? v : '')

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const action = pickString(event && event.action)

  try {
    switch (action) {
      case 'getOpenId': {
        return { ok: true, data: { openid: OPENID } }
      }

      case 'create': {
        const now = Date.now()
        const name = pickString(event.name).trim() || '未命名作品'
        const width = Number(event.width || 0)
        const height = Number(event.height || 0)
        const res = await db.collection(COLLECTION).add({
          data: {
            _openid: OPENID, // 明确写入 openid，确保用户能查询到自己的作品
            name,
            createdAt: now,
            updatedAt: now,
            width,
            height,
            // fileIDs
            pointsFileId: '',
            thumbnailFileId: '',
            exportFileId: '',
            // flags
            isDeleted: false,
          },
        })
        return { ok: true, data: { id: res._id } }
      }

      case 'get': {
        const id = pickString(event.id)
        if (!id) return { ok: false, error: 'missing id' }
        const res = await db.collection(COLLECTION).doc(id).get()
        const doc = res.data
        if (!doc || doc._openid !== OPENID || doc.isDeleted === true) return { ok: false, error: 'not found' }
        return { ok: true, data: doc }
      }

      case 'savePoints': {
        const id = pickString(event.id)
        const pointsFileId = pickString(event.pointsFileId)
        const thumbnailFileId = pickString(event.thumbnailFileId)
        const exportFileId = pickString(event.exportFileId)
        const width = Number(event.width || 0)
        const height = Number(event.height || 0)
        const name = pickString(event.name).trim()

        if (!id) return { ok: false, error: 'missing id' }

        const res = await db.collection(COLLECTION).doc(id).get()
        const doc = res.data
        if (!doc || doc._openid !== OPENID || doc.isDeleted === true) return { ok: false, error: 'not found' }

        const patch = { updatedAt: Date.now() }
        if (pointsFileId) patch.pointsFileId = pointsFileId
        if (thumbnailFileId) patch.thumbnailFileId = thumbnailFileId
        if (exportFileId) patch.exportFileId = exportFileId
        if (width) patch.width = width
        if (height) patch.height = height
        if (name) patch.name = name

        await db.collection(COLLECTION).doc(id).update({ data: patch })
        return { ok: true }
      }

      default:
        return { ok: false, error: 'unknown action' }
    }
  } catch (err) {
    console.error(err)
    return { ok: false, error: 'internal error', detail: err && err.message }
  }
}
