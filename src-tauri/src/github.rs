#![allow(dead_code, reason = "transport is wired after GitHub App registration")]

use std::collections::HashSet;

pub const AUTHORED_PULL_REQUESTS_QUERY: &str = "is:pr is:open author:@me";
pub const REVIEW_REQUESTED_PULL_REQUESTS_QUERY: &str = "is:pr is:open review-requested:@me";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PullRequestReference {
    pub id: String,
    pub repository: String,
    pub number: u64,
}

pub fn merge_pull_request_scopes(
    authored: impl IntoIterator<Item = PullRequestReference>,
    review_requested: impl IntoIterator<Item = PullRequestReference>,
) -> Vec<PullRequestReference> {
    let mut seen = HashSet::new();
    authored
        .into_iter()
        .chain(review_requested)
        .filter(|pull_request| seen.insert(pull_request.id.clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pull_request(id: &str, number: u64) -> PullRequestReference {
        PullRequestReference {
            id: id.into(),
            repository: "owner/repo".into(),
            number,
        }
    }

    #[test]
    fn scope_queries_match_the_product_universe() {
        assert_eq!(AUTHORED_PULL_REQUESTS_QUERY, "is:pr is:open author:@me");
        assert_eq!(
            REVIEW_REQUESTED_PULL_REQUESTS_QUERY,
            "is:pr is:open review-requested:@me"
        );
    }

    #[test]
    fn overlapping_scopes_are_deduplicated_by_node_id() {
        let authored = vec![pull_request("PR_1", 1), pull_request("PR_2", 2)];
        let requested = vec![pull_request("PR_2", 2), pull_request("PR_3", 3)];

        let merged = merge_pull_request_scopes(authored, requested);

        assert_eq!(merged.len(), 3);
        assert_eq!(
            merged
                .iter()
                .map(|pull_request| pull_request.id.as_str())
                .collect::<Vec<_>>(),
            ["PR_1", "PR_2", "PR_3"]
        );
    }
}
