# DBML ERD 测试

## 1. 用户组织

```dbml
Table users { id int [pk] org_id int [ref: > orgs.id] name varchar email varchar [unique] }
Table orgs { id int [pk] name varchar }
Ref: users.org_id > orgs.id
```

## 2. 订单域

```dbml
Table customers { id int [pk] name varchar tier varchar }
Table orders { id int [pk] customer_id int [ref: > customers.id] total decimal status varchar }
Table order_items { id int [pk] order_id int [ref: > orders.id] sku varchar qty int price decimal }
Ref: order_items.order_id > orders.id
```

## 3. 文档导出

```dbml
Table documents { id int [pk] path varchar title varchar updated_at timestamp }
Table export_tasks { id int [pk] document_id int [ref: > documents.id] format varchar status varchar }
Table export_artifacts { id int [pk] task_id int [ref: > export_tasks.id] file_path varchar size int }
Ref: export_tasks.document_id > documents.id
Ref: export_artifacts.task_id > export_tasks.id
```

## 4. RendererPlugin

```dbml
Table renderers { id int [pk] type varchar [unique] display_name varchar network_policy varchar }
Table renderer_capabilities { id int [pk] renderer_id int [ref: > renderers.id] target varchar state varchar }
Table renderer_warnings { id int [pk] renderer_id int [ref: > renderers.id] code varchar reason text }
```

## 5. 权限模型

```dbml
Table accounts { id int [pk] username varchar [unique] }
Table roles { id int [pk] code varchar [unique] }
Table account_roles { account_id int [ref: > accounts.id] role_id int [ref: > roles.id] }
Table permissions { id int [pk] role_id int [ref: > roles.id] action varchar resource varchar }
```

## 6. 内容管理

```dbml
Table folders { id int [pk] parent_id int [ref: > folders.id] name varchar }
Table files { id int [pk] folder_id int [ref: > folders.id] name varchar ext varchar }
Table bookmarks { id int [pk] file_id int [ref: > files.id] heading varchar line int }
```

## 7. 测试结果

```dbml
Table test_runs { id int [pk] branch varchar started_at timestamp duration_ms int }
Table test_cases { id int [pk] run_id int [ref: > test_runs.id] name varchar status varchar }
Table screenshots { id int [pk] case_id int [ref: > test_cases.id] path varchar diff_ratio decimal }
```

## 8. 审计日志

```dbml
Table actors { id int [pk] name varchar }
Table audit_logs { id int [pk] actor_id int [ref: > actors.id] action varchar target varchar created_at timestamp }
Table audit_payloads { id int [pk] log_id int [ref: > audit_logs.id] payload json }
```

## 9. 知识库

```dbml
Table articles { id int [pk] slug varchar [unique] title varchar }
Table tags { id int [pk] name varchar [unique] }
Table article_tags { article_id int [ref: > articles.id] tag_id int [ref: > tags.id] }
Table comments { id int [pk] article_id int [ref: > articles.id] body text }
```

## 10. 资产服务

```dbml
Table assets { id int [pk] sha256 varchar [unique] mime varchar bytes int }
Table asset_refs { id int [pk] asset_id int [ref: > assets.id] document_id int [ref: > documents.id] ref_path varchar }
Table documents { id int [pk] path varchar title varchar }
```

## 11. 配置中心

```dbml
Table settings { id int [pk] scope varchar key varchar value json }
Table setting_history { id int [pk] setting_id int [ref: > settings.id] old_value json new_value json }
Table feature_flags { id int [pk] key varchar [unique] enabled boolean }
```

## 12. 发布流水线

```dbml
Table releases { id int [pk] version varchar [unique] tag varchar }
Table release_assets { id int [pk] release_id int [ref: > releases.id] platform varchar path varchar }
Table changelog_items { id int [pk] release_id int [ref: > releases.id] category varchar body text }
```

## 13. 多租户组织模型

```dbml
Table tenants {
  id int [pk]
  name varchar
  status varchar
}
Table users {
  id int [pk]
  tenant_id int [not null]
  email varchar [unique]
}
Table teams {
  id int [pk]
  tenant_id int
  owner_id int
}
Table memberships {
  user_id int
  team_id int
  role varchar
}
Ref: users.tenant_id > tenants.id
Ref: teams.tenant_id > tenants.id
Ref: teams.owner_id > users.id
Ref: memberships.user_id > users.id
Ref: memberships.team_id > teams.id
```

## 14. 订单履约模型

```dbml
Table customers {
  id int [pk]
  phone varchar
  level varchar
}
Table orders {
  id int [pk]
  customer_id int
  address_id int
  status varchar
}
Table order_items {
  id int [pk]
  order_id int
  sku_id int
  quantity int
}
Table shipments {
  id int [pk]
  order_id int
  carrier varchar
}
Ref: orders.customer_id > customers.id
Ref: orders.address_id > customer_addresses.id
Ref: order_items.order_id > orders.id
Ref: order_items.sku_id > skus.id
Ref: shipments.order_id > orders.id
```

## 15. 学习平台模型

```dbml
Table students {
  id int [pk]
  org_id int
  name varchar
}
Table courses {
  id int [pk]
  teacher_id int
  title varchar
}
Table enrollments {
  id int [pk]
  student_id int
  course_id int
  progress decimal
}
Table exams {
  id int [pk]
  course_id int
  name varchar
}
Table exam_scores {
  id int [pk]
  exam_id int
  student_id int
  score decimal
}
Ref: students.org_id > organizations.id
Ref: courses.teacher_id > teachers.id
Ref: enrollments.student_id > students.id
Ref: enrollments.course_id > courses.id
Ref: exams.course_id > courses.id
Ref: exam_scores.exam_id > exams.id
Ref: exam_scores.student_id > students.id
```

## 16. 内容发布模型

```dbml
Table authors {
  id int [pk]
  name varchar
}
Table articles {
  id int [pk]
  author_id int
  category_id int
  title varchar
}
Table article_versions {
  id int [pk]
  article_id int
  version int
  body text
}
Table article_assets {
  id int [pk]
  article_id int
  asset_id int
}
Table publish_jobs {
  id int [pk]
  version_id int
  status varchar
}
Ref: articles.author_id > authors.id
Ref: articles.category_id > categories.id
Ref: article_versions.article_id > articles.id
Ref: article_assets.article_id > articles.id
Ref: article_assets.asset_id > assets.id
Ref: publish_jobs.version_id > article_versions.id
```

## 17. 支付风控模型

```dbml
Table accounts {
  id int [pk]
  user_id int
  status varchar
}
Table transactions {
  id int [pk]
  account_id int
  merchant_id int
  amount decimal
}
Table risk_events {
  id int [pk]
  transaction_id int
  rule_id int
  score decimal
}
Table risk_rules {
  id int [pk]
  policy_id int
  name varchar
}
Table settlements {
  id int [pk]
  transaction_id int
  batch_id int
}
Ref: accounts.user_id > users.id
Ref: transactions.account_id > accounts.id
Ref: transactions.merchant_id > merchants.id
Ref: risk_events.transaction_id > transactions.id
Ref: risk_events.rule_id > risk_rules.id
Ref: risk_rules.policy_id > risk_policies.id
Ref: settlements.transaction_id > transactions.id
```

## 18. 可观测性模型

```dbml
Table services {
  id int [pk]
  owner_team_id int
  name varchar
}
Table metric_series {
  id int [pk]
  service_id int
  metric_name varchar
}
Table trace_spans {
  id int [pk]
  service_id int
  parent_span_id int
}
Table log_events {
  id int [pk]
  service_id int
  trace_id int
}
Table alerts {
  id int [pk]
  service_id int
  rule_id int
}
Ref: services.owner_team_id > teams.id
Ref: metric_series.service_id > services.id
Ref: trace_spans.service_id > services.id
Ref: trace_spans.parent_span_id > trace_spans.id
Ref: log_events.service_id > services.id
Ref: alerts.service_id > services.id
Ref: alerts.rule_id > alert_rules.id
```

## 19. 文档协作模型

```dbml
Table documents {
  id int [pk]
  workspace_id int
  owner_id int
  path varchar
}
Table document_versions {
  id int [pk]
  document_id int
  author_id int
  revision int
}
Table comments {
  id int [pk]
  document_id int
  author_id int
  anchor varchar
}
Table comment_threads {
  id int [pk]
  root_comment_id int
  status varchar
}
Table attachments {
  id int [pk]
  document_id int
  asset_id int
}
Ref: documents.workspace_id > workspaces.id
Ref: documents.owner_id > users.id
Ref: document_versions.document_id > documents.id
Ref: document_versions.author_id > users.id
Ref: comments.document_id > documents.id
Ref: comments.author_id > users.id
Ref: comment_threads.root_comment_id > comments.id
Ref: attachments.document_id > documents.id
```

## 20. IoT 设备模型

```dbml
Table devices {
  id int [pk]
  product_id int
  gateway_id int
  serial varchar
}
Table products {
  id int [pk]
  vendor_id int
  model varchar
}
Table telemetry_points {
  id int [pk]
  device_id int
  metric_id int
  value decimal
}
Table commands {
  id int [pk]
  device_id int
  operator_id int
  status varchar
}
Table ota_jobs {
  id int [pk]
  product_id int
  firmware_id int
}
Ref: devices.product_id > products.id
Ref: devices.gateway_id > devices.id
Ref: products.vendor_id > vendors.id
Ref: telemetry_points.device_id > devices.id
Ref: telemetry_points.metric_id > metrics.id
Ref: commands.device_id > devices.id
Ref: ota_jobs.product_id > products.id
Ref: ota_jobs.firmware_id > firmware_versions.id
```

## 21. 数据湖血缘模型

```dbml
Table datasets {
  id int [pk]
  owner_id int
  name varchar
}
Table dataset_versions {
  id int [pk]
  dataset_id int
  schema_id int
}
Table jobs {
  id int [pk]
  pipeline_id int
  status varchar
}
Table job_inputs {
  job_id int
  dataset_version_id int
}
Table job_outputs {
  job_id int
  dataset_version_id int
}
Ref: datasets.owner_id > teams.id
Ref: dataset_versions.dataset_id > datasets.id
Ref: dataset_versions.schema_id > schemas.id
Ref: jobs.pipeline_id > pipelines.id
Ref: job_inputs.job_id > jobs.id
Ref: job_inputs.dataset_version_id > dataset_versions.id
Ref: job_outputs.job_id > jobs.id
Ref: job_outputs.dataset_version_id > dataset_versions.id
```

## 22. 工单服务模型

```dbml
Table tickets {
  id int [pk]
  requester_id int
  assignee_id int
  status varchar
}
Table ticket_events {
  id int [pk]
  ticket_id int
  actor_id int
  type varchar
}
Table sla_policies {
  id int [pk]
  priority varchar
  response_minutes int
}
Table ticket_slas {
  id int [pk]
  ticket_id int
  policy_id int
}
Table escalations {
  id int [pk]
  ticket_id int
  target_team_id int
}
Ref: tickets.requester_id > users.id
Ref: tickets.assignee_id > users.id
Ref: ticket_events.ticket_id > tickets.id
Ref: ticket_events.actor_id > users.id
Ref: ticket_slas.ticket_id > tickets.id
Ref: ticket_slas.policy_id > sla_policies.id
Ref: escalations.ticket_id > tickets.id
Ref: escalations.target_team_id > teams.id
```

## 23. 权限策略模型

```dbml
Table principals {
  id int [pk]
  type varchar
  name varchar
}
Table roles {
  id int [pk]
  tenant_id int
  name varchar
}
Table role_bindings {
  id int [pk]
  principal_id int
  role_id int
}
Table permissions {
  id int [pk]
  role_id int
  resource_id int
}
Table resources {
  id int [pk]
  parent_id int
  type varchar
}
Ref: roles.tenant_id > tenants.id
Ref: role_bindings.principal_id > principals.id
Ref: role_bindings.role_id > roles.id
Ref: permissions.role_id > roles.id
Ref: permissions.resource_id > resources.id
Ref: resources.parent_id > resources.id
```

## 24. 报表订阅模型

```dbml
Table reports {
  id int [pk]
  workspace_id int
  owner_id int
  title varchar
}
Table report_queries {
  id int [pk]
  report_id int
  datasource_id int
}
Table schedules {
  id int [pk]
  report_id int
  cron varchar
}
Table deliveries {
  id int [pk]
  schedule_id int
  channel_id int
}
Table delivery_logs {
  id int [pk]
  delivery_id int
  status varchar
}
Ref: reports.workspace_id > workspaces.id
Ref: reports.owner_id > users.id
Ref: report_queries.report_id > reports.id
Ref: report_queries.datasource_id > datasources.id
Ref: schedules.report_id > reports.id
Ref: deliveries.schedule_id > schedules.id
Ref: deliveries.channel_id > channels.id
Ref: delivery_logs.delivery_id > deliveries.id
```
