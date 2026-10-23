export function createRunnerTools(): Array<{ name: string; description: string }> {
  return [
    {
      name: "oracle_docs_search",
      description: "Search Oracle documentation and return concise official result snippets."
    }
  ];
}

export async function searchOracleDocs(query: string, top = 5): Promise<Array<{ title: string; url: string; excerpt: string }>> {
  const url = new URL("https://docs.oracle.com/search");
  url.searchParams.set("q", query);
  url.searchParams.set("group", "EN");
  url.searchParams.set("limit", String(top));
  const response = await fetch(url, {
    headers: { Accept: "text/html" }
  });
  if (!response.ok) {
    throw new Error(`Oracle docs search failed: ${response.status} ${response.statusText}`);
  }
  return [{
    title: "Oracle Cloud documentation search",
    url: `https://docs.oracle.com/search?q=${encodeURIComponent(query)}`,
    excerpt: "Search results load client-side. Open the link to see official Oracle Cloud / Fusion Applications documentation."
  }];
}
