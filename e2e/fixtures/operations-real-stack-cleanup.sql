DELETE FROM desk_documents WHERE document_id LIKE 'acceptance_%';
DELETE FROM strategy_signal_outbox WHERE strategy_instance_id = '33333333-3333-4333-8333-333333333333';
DELETE FROM strategy_kernel_audit_events WHERE strategy_kernel_audit_event_id = '44444444-4444-4444-8444-444444444444';
DELETE FROM strategy_instances WHERE strategy_instance_id = '33333333-3333-4333-8333-333333333333';
DELETE FROM strategy_versions WHERE strategy_definition_id = '11111111-1111-4111-8111-111111111111';
DELETE FROM strategy_definitions WHERE strategy_definition_id = '11111111-1111-4111-8111-111111111111';
