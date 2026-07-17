import uuid
"""
回收站专业化增强测试(S1):锁存 / 批量 / 确认词 / 只读预览 / stats 增强 / 隔离。
"""
import io
from datetime import datetime, timedelta


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def _upload(client, headers, name="doc.txt", body=b"trash-me", directory=""):
    r = client.post("/api/files/upload", headers=headers,
                    params={"directory": directory},
                    files={"file": (name, io.BytesIO(body), "text/plain")})
    assert r.status_code == 200, r.text
    return r.json()


def _soft_delete(client, headers, path):
    r = client.delete(f"/api/files?path={path}", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def test_trash_preview_text(client, make_user):
    """回收站只读预览文本正常。"""
    token, uid, _ = make_user(name := "trash-preview", password="Test1234pass")
    headers = _h(token)
    uploaded = _upload(client, headers, name="view.txt", body=b"hello trash")
    file_id = _soft_delete(client, headers, uploaded["path"])["file_id"]

    r = client.get(f"/api/files/trash/preview?file_id={file_id}", headers=headers)
    assert r.status_code in (200, 307), r.text  # 200 直接 / 307 重定向到文件


def test_trash_preview_html_blocked(client, make_user):
    """回收站预览 HTML 应被 415 拒绝(存储型 XSS 防护)。"""
    token, uid, _ = make_user(username=f"trash-html-"+uuid.uuid4().hex[:6], password="Test1234pass")
    headers = _h(token)
    # 直接注入 mime=text/html 的文件进回收站
    from app.db.models import SessionLocal, File as FileModel
    uploaded = _upload(client, headers, name="page.html", body=b"<script>alert(1)</script>")
    file_id = _soft_delete(client, headers, uploaded["path"])["file_id"]

    # 把 mime 改成 text/html 模拟恶意上传
    db = SessionLocal()
    try:
        f = db.query(FileModel).filter_by(owner_id=uid, id=file_id).first()
        f.mime_type = "text/html"
        db.commit()
    finally:
        db.close()

    r = client.get(f"/api/files/trash/preview?file_id={file_id}", headers=headers)
    assert r.status_code == 415, r.text


def test_trash_preview_ownership(client, make_user):
    """不能预览他人回收站文件。"""
    a_token, _, _ = make_user(username=f"trash-pa-"+uuid.uuid4().hex[:6], password="Test1234pass")
    b_token, _, _ = make_user(username=f"trash-pb-"+uuid.uuid4().hex[:6], password="Test1234pass")
    uploaded = _upload(client, _h(b_token), name="secret.txt", body=b"private")
    file_id = _soft_delete(client, _h(b_token), uploaded["path"])["file_id"]
    assert client.get(f"/api/files/trash/preview?file_id={file_id}", headers=_h(a_token)).status_code == 404


def test_lock_toggle(client, make_user):
    """锁存 / 解锁回收站文件。"""
    token, uid, _ = make_user(username=f"trash-lock-"+uuid.uuid4().hex[:6], password="Test1234pass")
    headers = _h(token)
    uploaded = _upload(client, headers, name="keep.txt", body=b"keep")
    file_id = _soft_delete(client, headers, uploaded["path"])["file_id"]

    # 锁存
    r = client.post("/api/files/trash/lock", headers=headers, json={"file_id": file_id, "locked": True})
    assert r.status_code == 200, r.text
    assert r.json()["locked"] is True

    # 已锁存文件跳过自动清理(手动把 deleted_at 设为 8 天前)
    from app.db.models import SessionLocal, File as FileModel
    db = SessionLocal()
    try:
        f = db.query(FileModel).filter_by(owner_id=uid, id=file_id).first()
        f.deleted_at = datetime.utcnow() - timedelta(days=8)
        db.commit()
    finally:
        db.close()

    r = client.post("/api/files/trash/purge", headers=headers)
    assert r.json()["purged"] == 0  # 锁存文件不被清理

    # 解锁
    r = client.post("/api/files/trash/lock", headers=headers, json={"file_id": file_id, "locked": False})
    assert r.json()["locked"] is False


def test_lock_limit(client, make_user):
    """锁存上限 DEFAULT_TRASH_LOCK_LIMIT(默认 200)。"""
    from app.db.models import SessionLocal, File as FileModel, DEFAULT_TRASH_LOCK_LIMIT
    token, uid, _ = make_user(username=f"trash-locklim-"+uuid.uuid4().hex[:6], password="Test1234pass")
    headers = _h(token)

    # 直接塞满锁存
    db = SessionLocal()
    try:
        now = datetime.utcnow()
        for i in range(DEFAULT_TRASH_LOCK_LIMIT):
            f = FileModel(owner_id=uid, path=f"/bulk/{i}.txt", name=f"{i}.txt",
                          size=1, deleted_at=now, locked_at=now)
            db.add(f)
        db.commit()
        # 再多一个未锁存文件,应锁不上
        extra = FileModel(owner_id=uid, path="/bulk/extra.txt", name="extra.txt",
                          size=1, deleted_at=now, locked_at=None)
        db.add(extra)
        db.commit()
        extra_id = extra.id
    finally:
        db.close()

    r = client.post("/api/files/trash/lock", headers=headers, json={"file_id": extra_id, "locked": True})
    assert r.status_code == 409, r.text  # 上限拦截


def test_batch_restore_partial_failure(client, make_user):
    """批量恢复:部分成功部分失败,不回滚。"""
    token, uid, _ = make_user(username=f"trash-brest-"+uuid.uuid4().hex[:6], password="Test1234pass")
    headers = _h(token)
    p1 = _upload(client, headers, name="br1.txt", body=b"a")["path"]
    id1 = _soft_delete(client, headers, p1)["file_id"]
    # id2 用不存在的 UUID
    r = client.post("/api/files/trash/restore-batch", headers=headers,
                    json={"file_ids": [id1, "00000000-0000-0000-0000-000000000000"]})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["succeeded"] == 1
    assert data["failed"] == 1
    assert data["results"][0]["ok"] is True
    assert data["results"][1]["ok"] is False


def test_batch_purge_skips_locked(client, make_user):
    """批量彻底删除:锁存文件跳过。"""
    token, uid, _ = make_user(username=f"trash-bpurge-"+uuid.uuid4().hex[:6], password="Test1234pass")
    headers = _h(token)
    p1 = _upload(client, headers, name="bp1.txt", body=b"a")["path"]
    p2 = _upload(client, headers, name="bp2.txt", body=b"b")["path"]
    id1 = _soft_delete(client, headers, p1)["file_id"]
    id2 = _soft_delete(client, headers, p2)["file_id"]

    # 锁存 id2
    client.post("/api/files/trash/lock", headers=headers, json={"file_id": id2, "locked": True})

    r = client.post("/api/files/trash/purge-batch", headers=headers, json={"file_ids": [id1, id2]})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["succeeded"] == 1
    assert data["skipped_locked"] == 1


def test_batch_too_many_rejected(client, make_user):
    """批量超过 200 条应 400。"""
    token, uid, _ = make_user(username=f"trash-bad-"+uuid.uuid4().hex[:6], password="Test1234pass")
    headers = _h(token)
    big = ["00000000-0000-0000-0000-000000000000"] * 201
    r = client.post("/api/files/trash/restore-batch", headers=headers, json={"file_ids": big})
    assert r.status_code == 400, r.text


def test_empty_confirm_word_required(client, make_user):
    """POST /trash/empty 必须传 confirm="永久删除"。"""
    token, uid, _ = make_user(username=f"trash-empty-"+uuid.uuid4().hex[:6], password="Test1234pass")
    headers = _h(token)
    p = _upload(client, headers, name="em.txt", body=b"x")["path"]
    _soft_delete(client, headers, p)

    # 缺 confirm
    assert client.post("/api/files/trash/empty", headers=headers, json={}).status_code == 400
    # 错误 confirm
    assert client.post("/api/files/trash/empty", headers=headers, json={"confirm": "删除"}).status_code == 400
    # 正确 confirm
    r = client.post("/api/files/trash/empty", headers=headers, json={"confirm": "永久删除"})
    assert r.status_code == 200, r.text
    assert r.json()["count"] == 1


def test_trash_stats_enhanced(client, make_user):
    """stats 返回 locked_count 与 will_expire_24h。"""
    from app.db.models import SessionLocal, File as FileModel
    token, uid, _ = make_user(username=f"trash-stats-"+uuid.uuid4().hex[:6], password="Test1234pass")
    headers = _h(token)
    p = _upload(client, headers, name="st.txt", body=b"x")["path"]
    fid = _soft_delete(client, headers, p)["file_id"]

    # 锁存
    client.post("/api/files/trash/lock", headers=headers, json={"file_id": fid, "locked": True})

    r = client.get("/api/files/trash/stats", headers=headers)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["total"] == 1
    assert d["locked_count"] == 1
    assert "will_expire_24h" in d


def test_list_includes_locked_field(client, make_user):
    """回收站列表返回 locked 字段。"""
    token, uid, _ = make_user(username=f"trash-list-"+uuid.uuid4().hex[:6], password="Test1234pass")
    headers = _h(token)
    p = _upload(client, headers, name="lst.txt", body=b"x")["path"]
    fid = _soft_delete(client, headers, p)["file_id"]
    client.post("/api/files/trash/lock", headers=headers, json={"file_id": fid, "locked": True})

    r = client.get("/api/files/trash", headers=headers)
    assert r.json()["items"][0]["locked"] is True
    assert "original_dir" in r.json()["items"][0]


def test_lock_ownership_isolation(client, make_user):
    """不能锁存/解锁他人回收站文件。"""
    a_token, _, _ = make_user(username=f"trash-loa-"+uuid.uuid4().hex[:6], password="Test1234pass")
    b_token, _, _ = make_user(username=f"trash-lob-"+uuid.uuid4().hex[:6], password="Test1234pass")
    uploaded = _upload(client, _h(b_token), name="other.txt", body=b"x")
    file_id = _soft_delete(client, _h(b_token), uploaded["path"])["file_id"]

    assert client.post("/api/files/trash/lock", headers=_h(a_token),
                      json={"file_id": file_id, "locked": True}).status_code == 404


def test_agent_delete_file_purge_parameter(make_user):
    """Agent delete_file 工具新增 purge 参数。"""
    from app.agent import tools

    # 为简洁,仅校验 schema 暴露 purge 参数。
    schema = next(s for s in tools.TOOL_SCHEMAS if s["function"]["name"] == "delete_file")
    assert "purge" in schema["function"]["parameters"]["properties"]


def test_trash_cleanup_assistant_registered():
    """trash_cleanup_assistant 工具已注册。"""
    from app.agent import tools
    assert "trash_cleanup_assistant" in tools.TOOL_FUNCTIONS
