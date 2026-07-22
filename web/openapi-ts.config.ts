import { defineConfig } from "@hey-api/openapi-ts";

/**
 * 从后端 OpenAPI 契约生成 TS 类型与 SDK（契约优先：API 漂移在编译期暴露）。
 * 重新生成：先刷新 openapi.json ——
 *   cd server && ENABLE_API_DOCS=true ../.venv/bin/python -c "import sys,json,os; \
 *     [os.environ.setdefault(k,v) for k,v in {'SECRET_KEY':'x'*40,'JWT_SECRET':'y'*40,'DATA_ENCRYPTION_KEY':'z'*40,'ADMIN_PASSWORD':'strong-pw-12345','DATABASE_PATH':'/tmp/sxd-openapi/db.sqlite','STORAGE_DIR':'/tmp/sxd-openapi/files'}.items()]; \
 *     os.makedirs('/tmp/sxd-openapi',exist_ok=True); sys.path.insert(0,'.'); \
 *     from app.main import app; json.dump(app.openapi(), open('../web/openapi.json','w'), ensure_ascii=False)"
 * 然后：npm run gen:api
 *
 * 生成的类型供视图按需引用；运行时请求统一走 src/api/client.ts（含 401 静默刷新，codegen 不提供）。
 */
export default defineConfig({
  input: "./openapi.json",
  output: {
    path: "./src/api/gen",
    format: "prettier",
  },
  plugins: ["@hey-api/typescript"],
});
