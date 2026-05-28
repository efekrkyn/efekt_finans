export function checkEnv() {
  const required = [] as const;
  const optional = ['DEEPSEEK_API_KEY','FINANCIAL_DATASETS_API_KEY','GOOGLE_API_KEY','OPENAI_API_KEY','ANTHROPIC_API_KEY','TAVILY_API_KEY','EXASEARCH_API_KEY'] as const;
  const missingRequired = required.filter(k => !process.env[k]);
  if (missingRequired.length) {
    console.error('❌ Eksik kritik env: ' + missingRequired.join(', '));
    process.exit(1);
  }
  const missingOptional = optional.filter(k => !process.env[k]);
  if (missingOptional.length) console.warn('⚠️  Opsiyonel env eksik: ' + missingOptional.join(', '));
  const llmKeys = ['DEEPSEEK_API_KEY','GOOGLE_API_KEY','OPENAI_API_KEY','ANTHROPIC_API_KEY'];
  if (!llmKeys.some(k => process.env[k])) console.warn('⚠️  Hiç LLM API key yok; AI endpointleri 503 dönecek.');
}
