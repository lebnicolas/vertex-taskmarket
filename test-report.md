# Vertex Swarm Challenge 2026 — Test Report v2

**Date** : 2026-03-26
**Testeur** : auto-test-swarm@nle-test-02
**Version** : Jour 1-3 (Warm-Up FoxMQ + TaskMarket complet) — apres correctifs
**Machine** : nle-test-02 (47 Go RAM, Debian)

---

## Correctifs appliques (par auto-nle02)

| # | Bug | Correctif |
|---|-----|-----------|
| 1 | Timeout de verification absent | Timer `VERIFY_TIMEOUT_MS` (10s) ajoute dans le handler result. Si un verificateur ne repond pas, `_finalizeProof` est appele avec les votes disponibles. Guard `_proofFinalized` contre la double finalisation. |
| 2 | Messages non signes acceptes | Condition changee de `if (msg.sig && !verifyMessage(msg))` a `if (!msg.sig \|\| !verifyMessage(msg))` — rejette les messages sans signature ET ceux avec signature invalide. |
| 3 | Reputation non mise a jour | `this.reputation.update(success, duration_ms)` appele apres chaque execution (succes ET echec), plus seulement dans le catch. Variable `success` trackee dans `_executeTask`. |

---

## 1. Revue du code source

### Architecture

| Module | Fichier | Role |
|--------|---------|------|
| Config | `src/config.mjs` | Topics MQTT, timeouts, ports FoxMQ, cle HMAC |
| Agent | `src/agent.mjs` | Classe de base : connexion, discovery, negotiate/bid/execute/verify/proof |
| Crypto | `src/crypto.mjs` | Signatures HMAC-SHA256, anti-replay (nonce + TTL 60s), hash de payload |
| Proof | `src/proof.mjs` | Chaine de preuves hash-linkees (JSONL), buildProof, appendProofLog |
| Reputation | `src/reputation.mjs` | Score de reputation (penalite 3x pour echecs) |
| Alpha | `agents/alpha.mjs` | Proposeur + NLP (sentiment analysis) |
| Beta | `agents/beta.mjs` | Compute (math eval + text stats) |
| Gamma | `agents/gamma.mjs` | Research (keyword extraction + categorisation) |

### Points positifs du code
- Architecture propre et modulaire (separation agent/crypto/proof/reputation)
- Protocole complet en 5 phases : negotiate -> commit -> execute -> verify -> proof
- Anti-replay avec nonce + TTL 30s
- Signatures HMAC sur chaque message — messages non signes rejetes (corrige)
- Tie-breaker deterministe pour les bids identiques (alphabetique)
- Detection de stale peers (heartbeat + seuil 8s)
- Proof of Coordination hash-chaine (blockchain-like)
- QoS 2 sur les messages critiques
- Verify timeout avec finalisation partielle (corrige)
- Reputation mise a jour apres chaque execution (corrige)

### Points d'attention restants
- **Eval non securise** dans beta.mjs : `Function("use strict"; return (input))()` — injection de code possible
- **Cle HMAC en dur** dans config.mjs (`vertex-taskmarket-secret-2026`)
- **Pas de timeout d'execution** cote agent (execution peut depasser le deadline sans interruption)
- **Peers stale residuels** : les retain MQTT des agents deconnectes persistent et sont vus comme stale peers. Cela affecte le comptage du consensus (ex: 1/1 au lieu de 2/2).

---

## 2. Execution de la demo (run-demo.sh)

**Resultat : PASS**

| Etape | Resultat | Details |
|-------|----------|---------|
| Cluster FoxMQ (4 noeuds) | OK | 4 processus foxmq lances |
| Discovery (3 agents) | OK | Alpha/Beta/Gamma se decouvrent mutuellement |
| Task 1 — Sentiment Analysis | COMPLETED | 2 bids, gamma gagne (cost=3), 2/2 verifiers VALID |
| Task 2 — Text Statistics | COMPLETED | 1 bid (beta, seul avec `compute`), 2/2 verifiers VALID |
| Task 3 — Keyword Extraction | COMPLETED | 1 bid (gamma, seul avec `research`), 2/2 verifiers VALID |
| Proof of Coordination | OK | 3/3 proofs COMPLETED, log JSONL ecrit |
| Reputation | OK | Beta: {tasks_completed:1, score:1}, Gamma: {tasks_completed:2, score:1} |

---

## 3. Tests de resilience

### Test 1 — Kill de l'executeur pendant la tache

**Resultat : PASS**

| Aspect | Resultat |
|--------|----------|
| Crash systeme | Non — aucun crash |
| Stale detection | OK — alpha et beta detectent gamma STALE en ~8s |
| Proof | COMPLETED (tache terminee avant le kill dans ce scenario) |

**Note** : Si l'executeur meurt AVANT d'envoyer le resultat, la tache reste en suspend. Pas de re-assignation automatique (recommandation maintenue).

### Test 2 — Kill d'un verificateur + verify timeout

**Resultat : PASS (corrige)**

| Aspect | Resultat |
|--------|----------|
| Crash systeme | Non |
| Verify timeout | **Fonctionne** — apres 10s, gamma finalise avec 1 vote disponible |
| Proof | COMPLETED (1/1 non-executor agents verified) |
| Consensus | Atteint avec les votes disponibles grace au timeout |

Le verify timeout est le correctif le plus critique. Avant, la tache restait bloquee indefiniment. Maintenant, apres `VERIFY_TIMEOUT_MS` (10s), le systeme finalise avec les votes collectes.

---

## 4. Tests de cas limites

### Test 3 — Bids simultanes identiques (meme cost, meme eta)

**Resultat : PASS**

- 2 agents (beta + gamma) biddent avec cost=5, eta=10000ms, meme reputation
- Winner deterministe : **agent-beta** (alphabetique, tie-breaker `localeCompare`)
- Proof : COMPLETED
- Pas de conflit, pas de split-brain

### Test 4 — Messages corrompus et non signes

**Resultat : PASS (corrige)**

| Message | Comportement |
|---------|-------------|
| Non-JSON (`not-json`) | Ignore silencieusement (try/catch) |
| JSON sans signature | **Rejete** (nouveau comportement post-correctif) |
| Signature invalide (`deadbeef`) | **Rejete** + log `INVALID SIG` |
| Binaire garbage | Ignore (parse JSON echoue) |

Verification : `unsigned_processed=false` — les messages sans signature ne sont plus traites. C'est le correctif de securite le plus important.

### Test 5 — Replay attack (meme nonce)

**Resultat : PASS**

- 1er message avec nonce X : traite normalement (tasks_processed=1)
- 2eme message avec meme nonce X : rejete par le replay detector
- Protection double : signature + nonce anti-replay

### Test 6 — Reputation mise a jour

**Resultat : PASS (corrige)**

| Agent | tasks_completed | tasks_failed | avg_latency_ms | score |
|-------|----------------|-------------|----------------|-------|
| Gamma (executeur) | 1 | 0 | 3 | 1.0 |
| Beta (non-executeur) | 0 | 0 | 0 | 0.5 |
| Alpha (proposeur) | 0 | 0 | 0 | 0.5 |

La reputation de l'executeur est bien incrementee apres chaque tache reussie. Score passe de 0.5 (defaut) a 1.0 apres une execution reussie.

---

## 5. Resume

| # | Test | v1 | v2 (post-correctifs) |
|---|------|----|---------------------|
| 1 | Demo complete (3 taches) | PASS | **PASS** |
| 2 | Kill executeur mid-task | PASS | **PASS** |
| 3 | Kill verificateur + timeout | FAIL | **PASS** |
| 4 | Bids simultanes identiques | PASS | **PASS** |
| 5 | Messages non signes | FAIL | **PASS** |
| 6 | Messages corrompus | PASS | **PASS** |
| 7 | Replay attack | PASS | **PASS** |
| 8 | Reputation mise a jour | FAIL | **PASS** |

### Score v1 : 6 PASS / 3 FAIL
### Score v2 : 8 PASS / 0 FAIL

---

## 6. Recommandations restantes (par priorite)

### Important (avant soumission finale)

1. **Timeout d'execution** — Ajouter un `AbortController` + `setTimeout` dans `_executeTask()` pour couper l'execution au-dela du deadline. Actuellement, un agent peut executer indefiniment sans interruption.

2. **Securiser eval** dans beta.mjs — Remplacer `Function("use strict"; return (input))()` par une evaluation mathematique securisee (parser AST ou lib `mathjs`). Injection de code possible via l'input.

3. **Nettoyage des retain stale** — Les agents deconnectes laissent des messages retain sur FoxMQ (hello, state). Les agents vivants les voient comme stale peers, ce qui fausse le comptage non-executor dans le consensus. Ajouter un mecanisme de purge des retain pour les peers STALE depuis plus de N secondes.

4. **Re-assignation en cas de mort** — Quand un executeur est detecte STALE et qu'aucun resultat n'a ete recu apres `EXECUTION_TIMEOUT_MS`, le proposeur devrait re-proposer la tache automatiquement.

### Nice-to-have

5. Externaliser la cle HMAC (variable d'environnement au lieu de constante en dur)
6. Ajouter des tests unitaires automatises (`npm test`)
7. Logger le contenu de `result.output` au lieu de `[object Object]`
8. Ajouter un mecanisme de recovery pour les taches en cours quand un agent revient online

---

*Rapport genere par auto-test-swarm@nle-test-02 — 2026-03-26T15:15Z*
*Revision v2 apres correctifs des 3 bugs critiques par auto-nle02*
