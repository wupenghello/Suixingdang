 # 多账户与管理员系统设计
 
 > 将"随行档"从单用户 MVP 升级为多账户系统，支持给其他人用，并新增独立管理员后台。
 
 ---
 
 ## 1. 设计目标
 
 - 多个普通用户，各自独立空间，互不可见
 - 一个独立的管理员账户，不混在普通用户里
 - 管理员可以管理用户（增删禁用、设配额、看统计），但不能看用户文件内容
 - 管理员有独立的后台界面和独立的登录入口
 - 普通用户的体验完全不变，感知不到多账户的存在
 
 ---
 
 ## 2. 身份模型
 
 ### 2.1 角色划分
 
 | 角色 | 登录入口 | 能做什么 |
 |------|---------|---------|
 | 普通用户 (user) | `/` 主站 | 管理自己的文件、用 AI 助手、管理自己的设备令牌 |
 | 管理员 (admin) | `/admin` 后台 | 管理所有用户、看系统统计、查审计日志、设置配额 |
 
 ### 2.2 双 Token 体系
 
 普通用户和管理员的 JWT 是分离的，通过 token 中的 `role` 字段区分：
 
 ```json
 // 普通用户 token
 {"sub": "user-uuid", "username": "zhangsan", "role": "user", "type": "access"}
 
 // 管理员 token  
 {"sub": "admin-uuid", "username": "admin", "role": "admin", "type": "access"}
 ```
 
 后端有两个独立的依赖注入函数：
 - `get_current_user` — 只接受 role=user 的 token，用于用户 API
 - `get_current_admin` — 只接受 role=admin 的 token，用于管理员 API
 
 ---
 
 ## 3. 数据模型变更
 
 ### 3.1 User 表（改动）
 
 新增字段：
 
 | 字段 | 类型 | 说明 |
 |------|------|------|
 | role | String | `user` 或 `admin`（默认 user）|
 | status | String | `active` / `disabled`（禁用后无法登录）|
 | quota_mb | Integer | 存储配额（MB），0 = 无限 |
 | created_at | DateTime | 注册时间 |
 
 移除：`is_admin`（用 role 字段替代）
 
 ### 3.2 File 表（改动）
 
 新增字段：
 
 | 字段 | 类型 | 说明 |
 |------|------|------|
 | owner_id | String (FK→users.id) | 文件所属用户，用于隔离 |
 
 ### 3.3 ChatMessage 表（改动）
 
 新增字段：
 
 | 字段 | 类型 | 说明 |
 |------|------|------|
 | user_id | String (FK→users.id) | 对话所属用户 |
 
 ### 3.4 AccessToken 表（改动）
 
 新增字段：
 
 | 字段 | 类型 | 说明 |
 |------|------|------|
 | user_id | String (FK→users.id) | 令牌所属用户 |
 
 ### 3.5 SyncEvent 表（改动）
 
 新增字段：
 
 | 字段 | 类型 | 说明 |
 |------|------|------|
 | user_id | String (FK→users.id) | 同步事件所属用户 |
 
 ### 3.6 AccessLog 表（改动）
 
 新增字段：
 
 | 字段 | 类型 | 说明 |
 |------|------|------|
 | user_id | String (FK→users.id, nullable) | 操作者（管理员操作可为 null）|
 
 ### 3.7 新增 Admin 表
 
 管理员使用独立表，彻底和普通用户分开：
 
 | 字段 | 类型 | 说明 |
 |------|------|------|
 | id | String (UUID) | 主键 |
 | username | String (unique) | 管理员用户名 |
 | password_hash | String | 密码哈希 |
 | totp_secret | String | 双因子密钥 |
 | totp_enabled | Boolean | 是否启用双因子 |
 | created_at | DateTime | 创建时间 |
 
 ---
 
 ## 4. 文件隔离策略
 
 ### 4.1 存储隔离
 
 每个用户的文件存储在独立的子目录下：
 
 ```
 /data/files/
 ├── {user_id_1}/          # 用户1的文件
 │   ├── work/
 │   ├── study/
 │   └── ...
 ├── {user_id_2}/          # 用户2的文件
 │   ├── work/
 │   └── ...
 ```
 
 storage 层的所有操作都带上 `user_id` 前缀，确保用户 A 永远无法访问用户 B 的文件。
 
 ### 4.2 数据库隔离
 
 所有文件查询都加上 `owner_id` 过滤：
 
 ```python
 db.query(File).filter(File.owner_id == user.id)
 ```
 
 ### 4.3 向量索引隔离
 
 Chroma 的 collection 按用户隔离：
 
 ```
 collection: "files_user_{user_id}"
 ```
 
 每个用户有自己的向量集合，搜索时只搜自己的。
 
 ---
 
 ## 5. API 设计
 
 ### 5.1 用户注册（开放/关闭开关）
 
 | 方法 | 路径 | 说明 |
 |------|------|------|
 | POST | `/api/auth/register` | 注册新用户（需 ALLOW_REGISTER 开关打开）|
 
 ### 5.2 管理员 API（全部需要 admin token）
 
 前缀：`/api/admin`
 
 | 方法 | 路径 | 说明 |
 |------|------|------|
 | POST | `/api/admin/login` | 管理员登录（独立入口）|
 | GET | `/api/admin/users` | 用户列表 |
 | POST | `/api/admin/users` | 创建用户 |
 | PUT | `/api/admin/users/{id}` | 修改用户（配额/状态）|
 | DELETE | `/api/admin/users/{id}` | 删除用户 |
 | GET | `/api/admin/stats` | 系统统计（总用户/总文件/总存储）|
 | GET | `/api/admin/logs` | 审计日志 |
 
 ### 5.3 配额检查
 
 用户上传文件时，后端检查：
 
 ```python
 used = db.query(func.sum(File.size)).filter(File.owner_id == user.id).scalar() or 0
 if user.quota_mb > 0 and used + file_size > user.quota_mb * 1024 * 1024:
     raise HTTPException(413, "存储空间不足")
 ```
 
 ---
 
 ## 6. 前端设计
 
 ### 6.1 普通用户端（保持不变 + 注册入口）
 
 - 登录页新增"注册"按钮（如果管理员开启了注册）
 - 登录后体验和现在完全一样
 - 新增"个人设置"页：修改密码、查看配额
 
 ### 6.2 管理员后台（独立 SPA，`/admin`）
 
 独立的页面，独立的登录入口，和用户端完全分离：
 
 - **概览仪表盘**：用户总数、文件总数、存储总量、活跃用户
 - **用户管理**：创建/禁用/删除用户，设置配额
 - **审计日志**：查看所有操作记录
 
 ---
 
 ## 7. 实施步骤
 
 1. 改造数据库模型（加字段、加 Admin 表）
 2. 改造认证体系（双 token、两个依赖注入）
 3. 改造文件存储层（user_id 前缀）
 4. 改造所有 API 路由（加 owner_id 过滤）
 5. 新增管理员 API 路由
 6. 改造向量索引（按用户隔离）
 7. 前端：用户端加注册 + 个人设置
 8. 前端：管理员后台独立页面
 9. 数据迁移（现有数据归属到初始用户）
 10. 测试
