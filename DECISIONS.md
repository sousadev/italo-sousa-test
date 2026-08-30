# DECISIONS.md

## 1. Modelagem e arquitetura

- **Que classes/services/camadas você criou ou mudou além do que já veio pronto (controllers, DTOs, module)?**
  - `MoneyService`: Ajustei para suportar `Prisma.Decimal` e criei o método `calculateDecimal`. A ideia foi garantir que todo o pipeline de relatório rode em cima de decimal de precisão arbitrária sem converter pra `number` no meio do caminho.
  - `IngestionService`: Adicionei a lógica de upsert e verificação de chaves naturais usando `$transaction` para garantir atomicidade.
  - `ReportsService`: Concentrei a regra de negócio do relatório aqui: cruzamento de métricas por site, mapeamento de moedas, agrupar por dia e aplicar a conversão de câmbio dia a dia antes de somar o período.
  - `ReconciliationService`: Montei a busca contínua no intervalo `[from, to]` batendo as séries temporais com os `SiteMapping` e jogando logs no `Logger` padrão do Nest quando acha buraco de dados.
  - **Testes com Vitest**: Criei os arquivos de teste unitário pra cada service acima (`money`, `ingestion`, `reports` e `reconciliation`).

- **Por que essa divisão e não outra?**
  - Mantive a estrutura padrão do NestJS separando bem Controllers, Services e DTOs. Isso facilita muito mockar os dados nos testes unitários e mantém os controllers limpos só lidando com entrada/saída HTTP.

---

## 2. Inconsistências encontradas

- **Quais inconsistências você encontrou nos dados seedados (`FacebookAdMetric`, `GamAdMetric`, `SiteMapping`, `FxRate`)?**
  1. **Fusos horários:** O Facebook manda em horário local (`accountTimezone`) e o GAM grava em UTC (`utcDate`).
  2. **Moeda em `SiteMapping`:** A tabela `SiteMapping` não fala qual é a moeda do site. Tive que puxar a moeda a partir do `accountCurrency` das métricas do Facebook.
  3. **Gaps no `FxRate`:** Tem datas sem cotação USD/BRL gravada no banco.
  4. **Sites sem cadastro:** Encontrei registros no GAM com `siteCode` que não existem no `SiteMapping`.

- **Para cada uma: você ignorou (com justificativa), corrigiu ou sinalizou? Por quê?**
  1. **Fusos horários:** Padronizei tudo para chave de data `YYYY-MM-DD` (ignorando o offset de hora no agrupamento diário), já que cada plataforma reporta o consolidado do seu próprio dia civil.
  2. **Moeda do Site:** Inferida dinamicamente pegando o histórico do FB (`accountCurrency`). Se for `USD`, assume taxa 1.0; se for `BRL`, busca no `FxRate`.
  3. **Câmbio faltante:** Se a query não acha a taxa no dia, coloquei um fallback básico para a última disponível/taxa padrão, evitando que a API estoure 500 na resposta do relatório.
  4. **Sites não mapeados:** Filtrei esses caras fora da consolidação. Sem registro no `SiteMapping` fica impossível calcular o revShare e imposto pra fechar o P&L.

---

## 3. Idempotência e resiliência da ingestão

- **Qual chave natural você usa em `processMetrics` pra não duplicar uma linha ao reprocessar o mesmo payload?**
  - **Facebook:** `(siteRef, externalCampaignId, localDate)`
  - **GAM:** `(networkCode, siteCode, utcDate)`
  - Se o registro já existe no banco, faço um `update` com as métricas atualizadas em vez de dar `insert`.

- **O que acontece especificamente quando `facebook`/`gam` chegam vazios (`[]`)?**
  - O código só passa reto, retorna `200 OK` e não altera nada no banco.

---

## 4. Módulo de dinheiro

- **Qual representação numérica você escolheu pra `MoneyService#calculate` (`number`, `Decimal`, Value Object, outra lib)? Por quê?**
  - Usei `Decimal` (direto do `Prisma.Decimal` / `decimal.js`).
  - **Motivo:** Trabalhar com `number` em JS é pedir pra ter erro de arredondamento por causa do IEEE 754 (o clássico `0.1 + 0.2 = 0.30000000000000004`). Em relatórios financeiros, esse monte de dízima junta e faz o caixa não bater no final.

- **Por que a ordem de operações (revShare → tributo sobre receita → câmbio → tributo sobre custo de mídia) importa? O que mudaria no resultado se fosse diferente?**
  - Porque segue a regra do contrato:
    1. Tira o `revShare` da parceira em cima do bruto em USD.
    2. Aplica o tributo da receita sobre o que sobrou (ainda na moeda original).
    3. Converte para `BRL` usando a cotação exata daquele dia.
    4. Aplica o imposto sobre o custo de mídia local.
  - Se mudar essa ordem (ex: converter pra BRL antes ou tirar imposto antes do revShare), a base de cálculo muda por conta do câmbio diário e os valores de lucro/ROAS saem errados.

---

## 5. Reconciliação de gaps

- **Ao encontrar um gap, o que sua implementação faz com essa informação (só reporta na resposta, loga, outra coisa)?**
  - Monto a lista no payload de retorno (`GapReportOutputDto`) e também solto logs formatados via `Logger.warn` do NestJS pra facilitar se quiserem pendurar um monitoramento tipo Datadog depois.

---

## 6. Trade-offs e o que ficou de fora

- **O que você deixou de lado por tempo?**
  - Criar uma DLQ (Dead Letter Queue) ou tabela de staging para registrar payloads corrompidos da ingestão.
  - Adicionar as constraints de unicidade (`UNIQUE`) direto na migration do PostgreSQL (optei por fazer as checagens via aplicação/transação para não alterar o schema que veio pronto).
- **O que faria diferente com mais tempo disponível?**
  - Colocaria paginação nos endpoints de relatório e criaria um cache (Redis) para as taxas de câmbio para não ter que ir ao banco toda hora.

---

## 7. Escala

- **Se o volume de dados fosse 100x maior, o que mudaria na sua abordagem?**
  1. **Ingestão:** Jogaria as requisições recebidas numa fila (RabbitMQ/SQS ou BullMQ) e processaria em background fazendo `bulk upsert` (`INSERT ... ON CONFLICT DO UPDATE`), pra não sufocar as conexões do Postgres.
  2. **Relatórios:** Em vez de puxar todas as linhas pra memória da aplicação e agrupar na mão, passaria o agrupamento para queries nativas em SQL ou criava Materialized Views atualizadas periodicamente.
  3. **Pre-aggregation:** Teria um cron job noturno consolidando as métricas de dias anteriores em uma tabela de fato (`daily_metrics_summary`).
