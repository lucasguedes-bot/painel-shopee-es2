import time
import logging
from datetime import datetime
from playwright.sync_api import sync_playwright
from supabase import create_client, Client

# Configuração de Logs
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - [%(levelname)s] - %(message)s'
)

# Chaves do Supabase
SUPABASE_URL = "https://qgjdzrroqvrxteeckazr.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFnamR6cnJvcXZyeHRlZWNrYXpyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Nzg0NjkxNywiZXhwIjoyMTAzNDIyOTE3fQ.U-pgfYabsJe_4bAnpZiSaphIfqeFjZGByvjsnlA8diY"

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# URL da página no SPX
SPX_URL = "https://spx.shopee.com.br"  # Substitua pelo link direto da tela do SPX se houver

def ler_e_salvar(page):
    logging.info("Atualizando página SPX e realizando leitura...")
    
    # Recarrega a página mantendo a sessão do usuário ativa
    page.reload(wait_until="networkidle", timeout=60000)
    
    # Aguarda o carregamento da tabela de produtividade
    page.wait_for_selector('table', timeout=15000)

    # Captura as linhas da tabela
    rows = page.query_selector_all('tr')
    dados = []

    for row in rows[1:]:  # Pula a linha do cabeçalho
        cols = row.query_selector_all('td')
        if len(cols) >= 3:
            ops_id = cols[0].inner_text().strip()
            processado = cols[1].inner_text().strip()
            projecao = cols[2].inner_text().strip()

            if ops_id:
                dados.append({
                    "ops_id": ops_id,
                    "processado": int(processado) if processado.isdigit() else 0,
                    "projecao_hora": float(projecao.replace(',', '.')) if projecao.replace(',', '.').replace('.', '', 1).isdigit() else 0,
                    "hora_entrada": datetime.utcnow().isoformat()
                })

    # Upsert salva e atualiza os registros no Supabase
    if dados:
        supabase.table("produtividade").upsert(dados).execute()
        logging.info(f"Sucesso: {len(dados)} registros inseridos/atualizados no Supabase.")
    else:
        logging.warning("Nenhum dado capturado nesta leitura.")

def executar_loop_24h():
    with sync_playwright() as p:
        # Abre o Chromium em modo visível para permitir o login na 1ª vez
        browser = p.chromium.launch(headless=False, args=['--start-maximized'])
        context = browser.new_context(no_viewport=True)
        page = context.new_page()

        page.goto(SPX_URL, wait_until="networkidle")
        logging.info("Navegador aberto com sucesso. Realize o login no SPX caso seja solicitado.")
        
        # Pausa de 30 segundos para garantir tempo de login na primeira execução
        time.sleep(30)

        while True:
            try:
                ler_e_salvar(page)
            except Exception as e:
                logging.error(f"Erro na leitura do ciclo: {e}")
                logging.info("Aguardando o próximo ciclo para tentar reconectar...")

            # Aguarda exatamente 60 segundos mantendo a página aberta
            logging.info("Aguardando 1 minuto para a próxima atualização automática...")
            time.sleep(60)

if __name__ == "__main__":
    executar_loop_24h()