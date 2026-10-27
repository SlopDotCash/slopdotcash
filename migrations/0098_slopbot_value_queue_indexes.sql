-- Settlement gives every read value request a processing row. The running-claim
-- checks of the scheduler and the claim read only running rows, and settlement
-- reads only the deliveries of one PR, not the whole request history.
CREATE INDEX slopbot_value_processing_running
 ON slopbot_value_processing(state, lease_until);
CREATE INDEX slopbot_value_requests_pull
 ON slopbot_value_requests(repository_id, pull_request_number);
