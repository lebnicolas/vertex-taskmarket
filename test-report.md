# Vertex Swarm Challenge 2026 — Test Report

**Date** : 2026-03-26
**Testeur** : auto-test-swarm@nle-test-02
**Version** : Jour 1-3 (Warm-Up FoxMQ + TaskMarket complet)
**Machine** : nle-test-02 (47 Go RAM, Debian)

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
- Signatures HMAC sur chaque message
- Tie-breaker deterministe pour les bids identiques (alphabetique)
- Detection de stale peers (heartbeat + seuil 8s)
- Proof of Coordination hash-chaine (blockchain-like)
- QoS 2 sur les messages critiques (taches, bids, assigns, results, verifies)

### Points d'attention
- **Eval non securise** dans beta.mjs : `Function("use strict"; return (input))()` — injection de code possible
- **Cle HMAC en dur** dans config.mjs (`vertex-taskmarket-secret-2026`)
- Pas de timeout d'execution cote agent (voir Test 4)
- Le warm-up handshake utilise un secret different du TaskMarket

---

## 2. Execution de la demo (run-demo.sh)

**Resultat : PASS**

| Etape | Resultat | Details |
|-------|----------|---------|
| Cluster FoxMQ (4 noeuds) | OK | 4 processus foxmq lances en <3s |
| Discovery (3 agents) | OK | Alpha/Beta/Gamma se decouvrent mutuellement |
| Task 1 — Sentiment Analysis | COMPLETED | 2 bids, gamma gagne (cost=3), 2/2 verifiers VALID |
| Task 2 — Text Statistics | COMPLETED | 1 bid (beta, seul avec `compute`), 2/2 verifiers VALID |
| Task 3 — Keyword Extraction | COMPLETED | 1 bid (gamma, seul avec `research`), 2/2 verifiers VALID |
| Proof of Coordination | OK | 3/3 proofs COMPLETED, log JSONL ecrit |

**Bug identifie** : Les reputations restent a `{score: 0.5, tasks_completed: 0}` pour tous les agents apres 3 taches executees. La methode `reputation.update()` n'est jamais appelee dans le chemin de succes de `_executeTask()` — elle n'est appelee que dans le `catch` (echec).

---

## 3. Tests de resilience

### Test 1 — Kill de l'executeur pendant la tache

**Resultat : PASS (avec reserve)**

| Aspect | Resultat |
|--------|----------|
| Crash systeme | Non — aucun crash |
| Stale detection | OK — alpha et beta detectent gamma STALE en ~10s |
| Comportement | Le resultat avait deja ete envoye avant le kill |
| Recuperation | Pas de mecanisme de re-assignation en cas de mort mid-task |

**Reserve** : Si l'executeur meurt AVANT d'envoyer le resultat, la tache reste en suspend indefiniment. Aucun timeout/retry automatique.

### Test 2 — Kill d'un verificateur

**Resultat : PASS (bug de consensus)**

| Aspect | Resultat |
|--------|----------|
| Crash systeme | Non |
| Impact | Avec 1 verificateur mort sur 2, le seuil de consensus n'est plus atteignable |
| Proof | **Jamais emise** — le systeme attend indefiniment les verifications manquantes |

**Bug critique** : Pas de timeout sur la collecte des verifications. Si un verificateur meurt, la tache ne se finalise jamais.

---

## 4. Tests de cas limites

### Test 3 — Bids simultanes identiques (meme cost, meme eta)

**Resultat : PASS**

- 2 agents (beta + gamma) biddent avec cost=5, eta=10000ms
- Winner deterministe : **agent-beta** (alphabetique, comme prevu par le tie-breaker)
- Proof : COMPLETED (2/2 verifiers VALID)
- Pas de conflit, pas de split-brain

### Test 4 — Timeout d'execution

**Resultat : PASS (fonctionnel) / FAIL (design)**

- Agent `slow` configure pour executer en 35s (deadline = 5s)
- **Aucun mecanisme de timeout** : l'agent continue d'executer sans interruption
- Le proposeur ne detecte pas le depassement de deadline
- Gamma verifie `duration_ms > deadline_ms` mais seulement APRES reception du resultat

**Recommandation** : Ajouter un `AbortController` + `setTimeout` dans `_executeTask()` pour couper l'execution au-dela du deadline.

### Test 5 — Messages corrompus

**Resultat : PASS**

| Message corrompu | Comportement agent |
|------------------|-------------------|
| Non-JSON (`not-json-at-all`) | Ignore silencieusement (try/catch dans _onMessage) |
| JSON incomplet (pas de sig) | Traite comme message non signe (pas de verification obligatoire) |
| Signature invalide | **Detecte** : `INVALID SIG` logue, message ignore |
| Timestamp ancien (replay 2020) | Accepte malgre la verification anti-replay |
| Binaire garbage | Ignore (parse JSON echoue) |

**Probleme de securite** : Les messages sans signature (`fake-002`) sont acceptes et traites. Le check `if (msg.sig && !verifyMessage(msg))` ne rejette que les messages avec une signature INVALIDE, pas ceux sans signature. Un attaquant peut envoyer des messages non signes.

### Test 6 — Replay attack (meme nonce)

**Resultat : PASS**

- Le replay detector fonctionne : le second message avec le meme nonce est rejete
- Combine avec la verification de signature, double protection

---

## 5. Resume

| # | Test | Resultat | Severite |
|---|------|----------|----------|
| 1 | Demo complete (3 taches) | **PASS** | — |
| 2 | Kill executeur mid-task | **PASS** (avec reserve) | Moyen |
| 3 | Kill verificateur | **PASS** (bug consensus) | **Eleve** |
| 4 | Bids simultanes identiques | **PASS** | — |
| 5 | Timeout d'execution | **FAIL** (pas de timeout) | **Eleve** |
| 6 | Messages corrompus | **PASS** | — |
| 7 | Messages non signes acceptes | **FAIL** (securite) | **Eleve** |
| 8 | Replay attack | **PASS** | — |
| 9 | Reputation non mise a jour | **FAIL** (bug) | Moyen |

### Score : 6 PASS / 3 FAIL

---

## 6. Recommandations (par priorite)

### Critique (a corriger avant Jour 4)

1. **Timeout d'execution** — Ajouter un `AbortController` dans `_executeTask()` avec `setTimeout` pour couper au-dela du deadline.

2. **Rejet des messages non signes** — Changer la condition dans `_onMessage()` :
   - Avant (vulnerable) : `if (msg.sig && !verifyMessage(msg)) { return; }`
   - Apres (securise) : `if (!msg.sig || !verifyMessage(msg)) { return; }`

3. **Timeout de verification** — Ajouter un timer dans la collecte des `verify` pour finaliser avec les votes disponibles apres `VERIFY_TIMEOUT_MS`.

### Important (avant soumission)

4. **Fix reputation** — Appeler `this.reputation.update(true, duration_ms)` dans le chemin de succes de `_executeTask()` (pas seulement dans le catch).

5. **Securiser eval** dans beta.mjs — Remplacer `Function(...)()`par une evaluation mathematique securisee (ex: parser AST simple ou bibliotheque `mathjs`).

6. **Re-assignation en cas de mort** — Quand un executeur est detecte STALE et qu'aucun resultat n'a ete recu, le proposeur devrait re-proposer la tache automatiquement.

### Nice-to-have

7. Externaliser la cle HMAC (variable d'environnement au lieu de constante en dur)
8. Ajouter des tests unitaires automatises (le projet n'a aucun test `npm test`)
9. Logger le contenu de `result.output` au lieu de `[object Object]` dans les logs

---

*Rapport genere par auto-test-swarm@nle-test-02 — 2026-03-26T14:55Z*
