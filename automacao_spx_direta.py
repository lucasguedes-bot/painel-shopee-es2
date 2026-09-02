import asyncio
import re
from datetime import datetime
from playwright.async_api import async_playwright
from supabase import create_client, Client

SUPABASE_URL = "https://qgjdzrroqvrxteeckazr.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFnamR6cnJvcXZyeHRlZWNrYXpyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Nzg0NjkxNywiZXhwIjoyMTAzNDIyOTE3fQ.U-pgfYabsJe_4bAnpZiSaphIfqeFjZGByvjsnlA8diY"

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
URL_SPX = "https://spx.shopee.com.br/#/productivity?type=individual"

def converter_float(texto, max_valor=999.99):
    """Converte o texto para float e garante que não ultrapasse o limite numeric(5,2)."""
    try:
        texto_limpo = re.sub(r'[^\d,-]', '', texto.strip()).replace(',', '.')
        valor = float(texto_limpo) if texto_limpo else 0.0
        return min(round(valor, 2), max_valor)
    except ValueError:
        return 0.0

def converter_int(texto):
    try:
        texto_limpo = re.sub(r'\D', '', texto.strip())
        return int(texto_limpo) if texto_limpo else 0
    except ValueError:
        return 0

def formatar_timestamp(texto):
    if not texto:
        return None
    texto_limpo = texto.strip()
    match_completo = re.search(r'\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}', texto_limpo)
    if match_completo:
        return match_completo.group(0)

    match_hora = re.search(r'\b\d{1,2}:\d{2}(:\d{2})?\b', texto_limpo)
    if match_hora:
        hoje = datetime.now().strftime("%Y-%m-%d")
        return f"{hoje} {match_hora.group(0)}"

    return None

def limitar_texto(texto, limite=50):
    return texto[:limite].strip() if texto else ""

async def extrair_e_enviar():
    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            user_data_dir="./sessao_shopee",
            headless=False,
            args=["--start-maximized"]
        )
        
        page = await browser.new_page()
        print("🌐 Acessando o SPX Shopee...")
        await page.goto(URL_SPX)

        print("⏳ Aguardando 15 segundos para renderizar a página...")
        await page.wait_for_timeout(15000)

        dados = []
        alvos = [page] + page.frames

        for alvo in alvos:
            linhas = await alvo.query_selector_all("tr, .el-table__row")
            if len(linhas) > 0:
                print(f"🔍 Processando {len(linhas)} linhas...")
                
                for linha in linhas:
                    colunas = await linha.query_selector_all("td")
                    textos = [await col.inner_text() for col in colunas]
                    textos = [t.strip().replace('\n', ' ') for t in textos if t.strip()]
                    
                    if not textos:
                        continue

                    if len(textos) >= 4 and not "OPS ID" in textos[0]:
                        item = {
                            "ops_id": limitar_texto(textos[0]),
                            "workstation": limitar_texto(textos[1] if len(textos) > 1 else ""),
                            "grupo": limitar_texto(textos[2] if len(textos) > 2 else ""),
                            "atividade": limitar_texto(textos[3] if len(textos) > 3 else ""),
                            "horas_trabalhadas": converter_float(textos[4] if len(textos) > 4 else "0"),
                            "projecao_hora": converter_float(textos[5] if len(textos) > 5 else "0"),
                            "processado": converter_int(textos[6] if len(textos) > 6 else "0"),
                            "hora_entrada": formatar_timestamp(textos[7]) if len(textos) > 7 else None,
                            "hora_saida": formatar_timestamp(textos[8]) if len(textos) > 8 else None
                        }
                        dados.append(item)

                if dados:
                    break

        if dados:
            supabase.table("produtividade").insert(dados).execute()
            print(f"✅ SUCESSO! {len(dados)} linhas inseridas com sucesso no Supabase!")
        else:
            print("⚠️ Nenhuma linha válida encontrada para envio.")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(extrair_e_enviar())