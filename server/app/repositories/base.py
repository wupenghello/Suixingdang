"""仓库层基类：强制多租户行级隔离。

所有按用户查询必须经 for_user()/active() 等预绑定过滤器构造，
handler 层拿不到无主查询——把散布在 30+ 处的 `owner_id == user.id`
内联过滤收敛为仓库层不变式。
"""

from sqlalchemy.orm import Session, Query


class Repository:
    model = None                 # 子类指定 ORM 模型
    owner_column = "owner_id"    # 租户隔离列（部分表为 user_id）

    def __init__(self, db: Session):
        self.db = db

    def for_user(self, user_id: str) -> Query:
        """返回预绑定租户过滤的查询——仓库层强制隔离入口。"""
        return self.db.query(self.model).filter(
            getattr(self.model, self.owner_column) == user_id
        )
