import time
import re
from datetime import datetime
from playwright.sync_api import sync_playwright
from supabase import create_client, Client

SUPABASE_URL = "https://qgjdzrroqvrxteeckazr.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFnamR6cnJvcXZyeHRlZWNrYXpyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Nzg0NjkxNywiZXhwIjoyMTAzNDIyOTE3fQ.U-pgfYabsJe_4bAnpZiSaphIfqeFjZGByvjsnlA8diY"

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
URL_SPX = "https://spx.shopee.com.br/#/productivity"

def extrair_numero(texto):
    if not texto:
        return 0
    limpo = re.sub(r'[^\d.]', '', str(texto).replace(',', '.'))
    try:
        return float(limpo) if '.' in limpo else int(limpo)
    except ValueError:
        return 0

def formatar_timestamp(texto_hora):
    if not texto_hora or str(texto_hora).strip() in ['0', '-', 'None', 'null', '']:
        return None
    texto_hora = str(texto_hora).strip()
    match_hora = re.search(r'(\d{2}):(\d{2})(?::(\d{2}))?', texto_hora)
    if match_hora:
        hoje = datetime.now().strftime('%Y-%m-%d')
        h, m, s = match_hora.group(1), match_hora.group(2), match_hora.group(3) or '00'
        return f"{hoje}T{h}:{m}:{s}-03:00"
    return None

def obter_conteudo_tabela(container):
    rows = container.query_selector_all("tbody tr")
    if not rows:
        rows = container.query_selector_all("tr.first-row, tr")
    return rows

def raspar_e_enviar(page):
    print("\n🔍 Lendo dados diretamente da página SPX...")
    page.wait_for_timeout(3000)

    rows = obter_conteudo_tabela(page)
    if not rows:
        for frame in page.frames:
            try:
                frame_rows = obter_conteudo_tabela(frame)
                if frame_rows and len(frame_rows) > 0:
                    rows = frame_rows
                    break
            except Exception:
                continue

    if not rows:
        print("⚠️ Tabela não encontrada nesta tentativa.")
        return

    dados = []
    for row in rows:
        cols = row.query_selector_all("td")
        if len(cols) < 7:
            continue

        textos = [c.inner_text().strip() for c in cols]
        ops_id = textos[0] if len(textos) > 0 else ""
        workstation = textos[1] if len(textos) > 1 else ""
        grupo = textos[2] if len(textos) > 2 else "-"
        atividade = textos[3] if len(textos) > 3 else ""
        horas_trabalhadas = extrair_numero(textos[4]) if len(textos) > 4 else 0
        projecao_hora = extrair_numero(textos[5]) if len(textos) > 5 else 0
        processado = int(extrair_numero(textos[6])) if len(textos) > 6 else 0
        
        hora_entrada = formatar_timestamp(textos[7] if len(textos) > 7 else None)
        hora_saida = formatar_timestamp(textos[8] if len(textos) > 8 else None)

        if not ops_id and not workstation:
            continue

        if "received" in atividade.lower():
            atividade = "INBOUND"
        if "termo" in workstation.lower() or "termo" in atividade.lower():
            workstation = f"P2_{workstation}"
        if "lona" in workstation.lower() or "lona" in atividade.lower():
            workstation = f"P1_{workstation}"

        item = {
            "ops_id": ops_id,
            "workstation": workstation,
            "grupo": grupo if grupo != "" else "-",
            "atividade": atividade,
            "horas_trabalhadas": horas_trabalhadas,
            "projecao_hora": projecao_hora,
            "processado": processado,
            "hora_entrada": hora_entrada,
            "hora_saida": hora_saida
        }
        dados.append(item)

    if dados:
        supabase.table("produtividade").insert(dados).execute()
        print(f"✅ SUCESSO! {len(dados)} registros gravados na tabela 'produtividade'!")
    else:
        print("⚠️ A tabela foi encontrada, mas nenhum dado válido foi processado.")

def iniciar_monitoramento():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()

        print(f"🚀 Navegando para {URL_SPX}...")
        page.goto(URL_SPX)

        print("\n🔑 Realize o login no SPX na janela do navegador.")
        input("👉 Quando a tabela estiver visível na tela, pressione ENTER aqui...")

        while True:
            try:
                if page.is_closed():
                    print("⚠️ Navegador fechado detectado. Recriando janela...")
                    context = browser.new_context()
                    page = context.new_page()
                    page.goto(URL_SPX)
                    input("👉 Realize o login se necessário e pressione ENTER para continuar...")

                page.reload()
                raspar_e_enviar(page)

            except Exception as e:
                print(f"❌ Erro no ciclo: {e}")
                try:
                    page = context.new_page()
                    page.goto(URL_SPX)
                except Exception:
                    pass

            print("⏳ Aguardando 60 segundos para a próxima leitura...")
            time.sleep(60)

if __name__ == "__main__":
    iniciar_monitoramento()