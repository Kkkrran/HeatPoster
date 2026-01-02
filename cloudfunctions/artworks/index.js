// 云函数：作品库
// 用法：wx.cloud.callFunction({ name: 'artworks', data: { action: 'list' } })
// action: list | rename | delete | get

const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const COLLECTION = 'artworks'

function pickString(v) {
  return typeof v === 'string' ? v : ''
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const action = pickString(event && event.action)

  try {
    switch (action) {
      case 'list': {
        const limit = Math.min(Math.max(Number(event.limit || 50), 1), 100)
        const res = await db
          .collection(COLLECTION)
          .where({ _openid: OPENID, isDeleted: _.neq(true) })
          .orderBy('updatedAt', 'desc')
          .limit(limit)
          .get()
        return { ok: true, data: res.data }
      }

      case 'get': {
        const id = pickString(event.id)
        if (!id) return { ok: false, error: 'missing id' }
        const res = await db.collection(COLLECTION).doc(id).get()
        const doc = res.data
        if (!doc || doc._openid !== OPENID) return { ok: false, error: 'not found' }
        return { ok: true, data: doc }
      }

      case 'rename': {
        const id = pickString(event.id)
        const name = pickString(event.name).trim()
        if (!id) return { ok: false, error: 'missing id' }
        if (!name) return { ok: false, error: 'missing name' }

        // 先校验归属
        const res = await db.collection(COLLECTION).doc(id).get()
        const doc = res.data
        if (!doc || doc._openid !== OPENID) return { ok: false, error: 'not found' }

        await db.collection(COLLECTION).doc(id).update({
          data: { name, updatedAt: Date.now() },
        })
        return { ok: true }
      }

      case 'delete': {
        const id = pickString(event.id)
        if (!id) return { ok: false, error: 'missing id' }

        // 先校验归属并拿 fileID
        const res = await db.collection(COLLECTION).doc(id).get()
        const doc = res.data
        if (!doc || doc._openid !== OPENID) return { ok: false, error: 'not found' }

        await db.collection(COLLECTION).doc(id).update({
          data: { isDeleted: true, updatedAt: Date.now() },
        })

        // 可选：删除云存储文件（失败不影响主流程）
        const fileList = [doc.thumbnailFileId, doc.exportFileId].filter(Boolean)
        if (fileList.length) {
          try {
            await cloud.deleteFile({ fileList })
          } catch (e) {
            // ignore
          }
        }

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
