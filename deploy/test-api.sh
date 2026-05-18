#!/usr/bin/env bash
# 半夏茶馆 REST API 冒烟测试。
# 用法：
#   后端启动后，BASE=http://127.0.0.1:3000 bash deploy/test-api.sh
#
# 依赖：curl, jq

set -euo pipefail

BASE="${BASE:-http://127.0.0.1:3000}"
PASS="alice12345"
NOW=$(date +%s)
UA="alice_${NOW}"
UB="bob_${NOW}"

say() { printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }
ok()  { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
die() { printf '  \033[1;31m✗\033[0m %s\n' "$*"; exit 1; }

assert_status() {
  local want="$1" got="$2" what="$3"
  [[ "$got" == "$want" ]] || die "$what: 期望 $want, 实际 $got"
}

req() {
  local method="$1" path="$2" data="${3:-}" token="${4:-}"
  local args=(-sS -X "$method" "$BASE$path" -H 'Content-Type: application/json')
  [[ -n "$token" ]] && args+=(-H "Authorization: Bearer $token")
  [[ -n "$data"  ]] && args+=(-d "$data")
  curl -o /tmp/_resp.json -w '%{http_code}' "${args[@]}"
}

say "/healthz"
CODE=$(curl -sS -o /tmp/_resp.json -w '%{http_code}' "$BASE/healthz")
assert_status 200 "$CODE" "/healthz"
jq -e .ok /tmp/_resp.json >/dev/null
ok "/healthz 正常"

say "注册 alice"
CODE=$(req POST /api/register "{\"username\":\"$UA\",\"password\":\"$PASS\",\"nickname\":\"A\",\"avatar\":\"🍵\"}")
assert_status 201 "$CODE" "register alice"
TOKEN_A=$(jq -r .token /tmp/_resp.json)
ok "alice 注册成功"

say "GET /api/me"
CODE=$(req GET /api/me "" "$TOKEN_A")
assert_status 200 "$CODE" "GET /api/me"
[[ "$(jq -r .user.username /tmp/_resp.json)" == "$UA" ]] || die "/me username 不匹配"
ok "/me OK"

say "创建房间"
CODE=$(req POST /api/rooms '{"name":"半夏茶馆","password":"teaisgood"}' "$TOKEN_A")
assert_status 201 "$CODE" "create room"
ROOM_ID=$(jq -r .room.id /tmp/_resp.json)
ROOM_CODE=$(jq -r .room.code /tmp/_resp.json)
ok "房间号 $ROOM_CODE"

say "注册 bob"
CODE=$(req POST /api/register "{\"username\":\"$UB\",\"password\":\"$PASS\",\"nickname\":\"B\",\"avatar\":\"🤖\"}")
assert_status 201 "$CODE" "register bob"
TOKEN_B=$(jq -r .token /tmp/_resp.json)
ok "bob 注册成功"

say "bob 加入房间（错密码 4 次）"
for i in 1 2 3 4; do
  CODE=$(req POST /api/rooms/join "{\"code\":\"$ROOM_CODE\",\"password\":\"wrongpass\"}" "$TOKEN_B")
  assert_status 422 "$CODE" "wrong attempt $i"
done
ok "4 次 INVALID_PASSWORD"

say "bob 第 5 次错密码 → ROOM_LOCKED"
CODE=$(req POST /api/rooms/join "{\"code\":\"$ROOM_CODE\",\"password\":\"wrongpass\"}" "$TOKEN_B")
assert_status 423 "$CODE" "5th wrong attempt locks"
[[ "$(jq -r .error.code /tmp/_resp.json)" == "ROOM_LOCKED" ]] || die "未返回 ROOM_LOCKED"
ok "锁定生效"

say "锁定中即使正确密码也应被挡住"
CODE=$(req POST /api/rooms/join "{\"code\":\"$ROOM_CODE\",\"password\":\"teaisgood\"}" "$TOKEN_B")
assert_status 423 "$CODE" "locked even with correct password"
ok "锁定行为正确"

say "alice 改密码 → bob 仍锁定中无法加入"
CODE=$(req PATCH "/api/rooms/$ROOM_ID/password" '{"new_password":"newteagood"}' "$TOKEN_A")
assert_status 200 "$CODE" "patch password"
ok "密码已改"

say "注册 carol（未受锁定影响）→ 用新密码加入"
UC="carol_${NOW}"
CODE=$(req POST /api/register "{\"username\":\"$UC\",\"password\":\"$PASS\",\"nickname\":\"C\",\"avatar\":\"🐸\"}")
assert_status 201 "$CODE" "register carol"
TOKEN_C=$(jq -r .token /tmp/_resp.json)
CODE=$(req POST /api/rooms/join "{\"code\":\"$ROOM_CODE\",\"password\":\"newteagood\"}" "$TOKEN_C")
assert_status 200 "$CODE" "carol joins"
ok "carol 加入成功"

say "alice 发消息，carol 拉历史"
CODE=$(req POST "/api/rooms/$ROOM_ID/messages" '{"content":"晚来天欲雪 @'"$UC"'","client_msg_id":"m1"}' "$TOKEN_A")
assert_status 201 "$CODE" "send msg"
MENTIONS=$(jq -r '.message.mentioned_user_ids | length' /tmp/_resp.json)
[[ "$MENTIONS" -ge 1 ]] || die "未解析 @ 提及"
ok "消息已发，@ 提及解析正确"

say "client_msg_id 幂等：同 id 重发"
CODE=$(req POST "/api/rooms/$ROOM_ID/messages" '{"content":"重发","client_msg_id":"m1"}' "$TOKEN_A")
assert_status 201 "$CODE" "idempotent send"
ok "幂等 OK"

say "拉历史"
CODE=$(req GET "/api/rooms/$ROOM_ID/messages" "" "$TOKEN_C")
assert_status 200 "$CODE" "list messages"
COUNT=$(jq -r '.messages | length' /tmp/_resp.json)
[[ "$COUNT" -eq 1 ]] || die "期望 1 条消息，实际 $COUNT"
ok "历史拉取正确（去重后只 1 条）"

say "踢 carol → 黑名单"
CARROT_UID=$(jq -r '.messages[0].mentioned_user_ids[0]' /tmp/_resp.json)
CODE=$(req POST "/api/rooms/$ROOM_ID/kick" "{\"user_id\":$CARROT_UID}" "$TOKEN_A")
assert_status 200 "$CODE" "kick carol"
CODE=$(req POST /api/rooms/join "{\"code\":\"$ROOM_CODE\",\"password\":\"newteagood\"}" "$TOKEN_C")
assert_status 403 "$CODE" "banned"
[[ "$(jq -r .error.code /tmp/_resp.json)" == "ROOM_BANNED" ]] || die "未返回 ROOM_BANNED"
ok "黑名单生效"

say "alice 删除房间"
CODE=$(req DELETE "/api/rooms/$ROOM_ID" "" "$TOKEN_A")
assert_status 200 "$CODE" "delete room"
CODE=$(req GET "/api/rooms/$ROOM_ID" "" "$TOKEN_A")
assert_status 404 "$CODE" "room gone"
ok "房间已删"

printf '\n\033[1;32mAll smoke checks passed.\033[0m\n'
