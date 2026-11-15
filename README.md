# AgroGestor · painel da Fazenda Santa Helena

Painel web do Grupo 1 para acompanhar os dados reais da Fazenda Santa Helena, em Pompeia/SP. A aplicação mantém uma única API Node.js que consulta MariaDB, MongoDB e Redis e recebe telemetria pelo MQTT. As credenciais ficam no servidor; o navegador recebe apenas os dados necessários para montar o painel.

## Fontes de dados

- MariaDB `grupo1`: fazenda, talhões, culturas e cadastro de sensores (tipo, talhão, fabricante e intervalo nominal).
- MongoDB `grupo1`: leituras históricas, alertas, telemetria de máquinas e metadados de imagens (NDVI, cobertura de nuvens e chave do objeto).
- Redis: estado recente da fazenda, talhões, sensores e stream de leituras.
- MQTT: tópico restrito a `grupo/1/#`.
- MinIO: conferência das chaves do bucket `grupo1` contra os metadados MongoDB.

A interface apresenta o estado de cada integração e não substitui leituras ausentes por dados fictícios. A área cadastrada é comparada à soma dos talhões, e a diferença permanece visível sem ser atribuída a uma cultura. O painel também separa os metadados das imagens dos objetos armazenados no MinIO. O endpoint `/health` verifica se o processo web está respondendo; o estado dos serviços de dados aparece em Integrações.

## Execução local

Requisitos: Node.js 20 ou superior, Poppler (`pdftotext`) e o PDF de acesso da turma na raiz do projeto.

```sh
npm install
npm run setup
npm start
```

A aplicação abre em `http://localhost:3000`. O comando `setup` lê endpoints e credenciais do PDF de acesso para os quatro serviços de dados e o MinIO, e grava `.env` com permissão privada. Não versione, compartilhe nem inclua `.env` ou `PI2026-T2-acessos.pdf` na imagem Docker.

## Docker local

Depois de gerar `.env`, construa e execute o contêiner:

```sh
docker compose up --build -d
```

Acesse `http://localhost:3000`. O Compose verifica `/health` e reinicia o contêiner se o processo web parar. As conexões às bases são iniciadas em segundo plano; a página continua disponível enquanto algum serviço externo estiver fora do ar e tenta reconectar.

## Portainer do Grupo 1

O arquivo `portainer-stack.yaml` usa uma imagem já publicada e injeta as conexões como variáveis da stack. No Portainer, configure `AGROGESTOR_IMAGE`, `MARIADB_URL`, `MONGODB_URI`, `REDIS_URL`, `MQTT_URL`, `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY` e `MINIO_SECRET_KEY`; mantenha `MQTT_TOPIC=grupo/1/#` e use a porta `8081` (ou outra livre entre `8081` e `8090`). Os valores das credenciais devem vir do material de acesso da turma e não devem entrar no repositório.

O diretório inclui `Dockerfile` para gerar a imagem. Ambientes Portainer remotos não constroem imagens a partir de `build:` dentro do arquivo Compose; nesse caso, publique a imagem em um registry acessível pelo Portainer e informe seu nome em `AGROGESTOR_IMAGE` antes de implantar a stack.
