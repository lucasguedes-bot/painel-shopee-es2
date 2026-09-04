import os
import re
import sys
import time
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

from selenium import webdriver
from selenium.common.exceptions import StaleElementReferenceException, TimeoutException, WebDriverException
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait
from supabase import Client, create_client

# ============================================================
# CONFIGURAÇÃO
# ============================================================
URL_SPX = "https://spx.shopee.com.br/#/productivity"
TABELA_SUPABASE = "produtividade"
INTERVALO_SEGUNDOS = 60
TIMEOUT = 30
PAUSA_CLIQUE = 2.0
PAUSA_APOS_PESQUISA = 5.0
FUSO = ZoneInfo("America/Sao_Paulo")

# Configure no PowerShell antes de executar:
# $env:SPX_LOGIN = os.getenv("SPX_LOGIN", "")
# $env:SPX_SENHA = os.getenv("SPX_SENHA", "")
# $env:SUPABASE_URL = os.getenv("SUPABASE_URL", "")
# $env:SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")
SPX_LOGIN = "Ops327511"
SPX_SENHA = "Bernardo1."
SUPABASE_URL = "https://qgjdzrroqvrxteeckazr.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFnamR6cnJvcXZyeHRlZWNrYXpyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Nzg0NjkxNywiZXhwIjoyMTAzNDIyOTE3fQ.U-pgfYabsJe_4bAnpZiSaphIfqeFjZGByvjsnlA8diY"

if not all((SPX_LOGIN, SPX_SENHA, SUPABASE_URL, SUPABASE_KEY)):
    raise RuntimeError("Configure SPX_LOGIN, SPX_SENHA, SUPABASE_URL e SUPABASE_KEY.")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Para executar em segundo plano, remova o comentário:
# O modo headless é configurado dentro de iniciar_monitoramento().

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)-7s | %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("robo-spx")
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)


def separador():
    print("-" * 70)


def agora_local() -> datetime:
    return datetime.now(FUSO)


def countdown(segundos: int):
    try:
        for restante in range(segundos, 0, -1):
            m, s = divmod(restante, 60)
            sys.stdout.write(f"\rPróxima execução em {m:02d}:{s:02d}   ")
            sys.stdout.flush()
            time.sleep(1)
        sys.stdout.write("\r" + " " * 80 + "\rIniciando nova execução...\n")
        sys.stdout.flush()
    except KeyboardInterrupt:
        sys.stdout.write("\r" + " " * 80 + "\r")
        sys.stdout.flush()
        raise


def numero(valor) -> float:
    texto = str(valor or "").strip().replace("%", "")
    texto = re.sub(r"[^0-9,.-]", "", texto)
    if not texto:
        return 0
    try:
        if "," in texto and "." in texto:
            texto = texto.replace(".", "").replace(",", ".")
        else:
            texto = texto.replace(",", ".")
        return float(texto)
    except ValueError:
        return 0


def inteiro(valor) -> int:
    return int(round(numero(valor)))


def timestamp_spx(valor: str) -> Optional[str]:
    valor = (valor or "").strip()
    if not valor or valor.lower() in {"-", "0", "null", "none"}:
        return None
    try:
        dt = datetime.strptime(valor[:19], "%Y-%m-%d %H:%M:%S")
        return dt.replace(tzinfo=FUSO).isoformat()
    except ValueError:
        match = re.search(r"(\d{1,2}):(\d{2})(?::(\d{2}))?", valor)
        if not match:
            return None
        dt = agora_local().replace(hour=int(match.group(1)), minute=int(match.group(2)), second=int(match.group(3) or 0), microsecond=0)
        return dt.isoformat()


def turno_da_hora(hora: int) -> str:
    if 6 <= hora < 14:
        return "T1"
    if 14 <= hora < 22:
        return "T2"
    return "T3"


def data_operacional(agora: Optional[datetime] = None) -> str:
    dt = agora or agora_local()
    if dt.hour < 6:
        dt -= timedelta(days=1)
    return dt.strftime("%Y-%m-%d")


def janela_working_time() -> Tuple[datetime, datetime, str, int, str]:
    agora = agora_local()
    inicio = agora.replace(minute=0, second=0, microsecond=0)
    if agora.minute <= 5:
        inicio -= timedelta(hours=1)
    fim = inicio + timedelta(hours=1)
    return inicio, fim, data_operacional(agora), inicio.hour, turno_da_hora(inicio.hour)


# ============================================================
# SELENIUM
# ============================================================
def esperar(driver, by, valor):
    return WebDriverWait(driver, TIMEOUT).until(EC.presence_of_element_located((by, valor)))


def clicar(driver, by, valor):
    elemento = WebDriverWait(driver, TIMEOUT).until(EC.element_to_be_clickable((by, valor)))
    driver.execute_script("arguments[0].scrollIntoView({block:'center',inline:'nearest'});", elemento)
    time.sleep(PAUSA_CLIQUE)
    elemento.click()
    return elemento


def preencher(elemento, valor: str):
    elemento.click()
    elemento.send_keys(Keys.CONTROL, "a")
    elemento.send_keys(valor)
    time.sleep(PAUSA_CLIQUE)


def fazer_login(driver):
    log.info("Abrindo o SPX...")
    driver.get(URL_SPX)
    esperar(driver, By.TAG_NAME, "body")
    time.sleep(3)
    usuario = WebDriverWait(driver, TIMEOUT).until(EC.presence_of_element_located((By.XPATH, "//input[@type='text' or @type='input' or contains(translate(@placeholder,'LOGINUSUARIO','loginusuario'),'login') or contains(translate(@placeholder,'LOGINUSUARIO','loginusuario'),'usuário')]")))
    senha = esperar(driver, By.XPATH, "//input[@type='password']")
    log.info("Preenchendo login...")
    preencher(usuario, SPX_LOGIN)
    preencher(senha, SPX_SENHA)
    senha.send_keys(Keys.ENTER)
    time.sleep(3)
    WebDriverWait(driver, TIMEOUT).until(lambda d: "login" not in d.current_url.lower() or d.find_elements(By.XPATH, "//label[contains(normalize-space(.),'Working Time')]") )
    log.info("Login concluído.")


def selecionar_packing(driver):
    log.info("Selecionando Packing...")
    campo = "//label[contains(normalize-space(.),'Tipo de Atividade')]/following-sibling::div//*[contains(@class,'ssc-select-reference')]"
    clicar(driver, By.XPATH, campo)
    opcao = "//*[contains(@class,'ssc-option') and translate(normalize-space(.),'PACKING','packing')='packing']"
    clicar(driver, By.XPATH, opcao)


def preencher_working_time(driver, inicio: datetime, fim: datetime):
    abertura = "//label[contains(normalize-space(.),'Working Time')]/following-sibling::div//input[@placeholder='Escolha a data de início']"
    clicar(driver, By.XPATH, abertura)
    painel = "//div[contains(@class,'ssc-picker-panel-main-container')]"
    WebDriverWait(driver, TIMEOUT).until(EC.visibility_of_element_located((By.XPATH, painel)))
    inputs = driver.find_elements(By.XPATH, painel + "//input")
    if len(inputs) < 4:
        raise RuntimeError(f"Working Time encontrou {len(inputs)} campos; esperados 4.")
    log.info(f"Working Time: {inicio:%Y-%m-%d %H:%M} até {fim:%Y-%m-%d %H:%M}")
    preencher(inputs[0], inicio.strftime("%Y-%m-%d"))
    preencher(inputs[1], inicio.strftime("%H:%M"))
    preencher(inputs[2], fim.strftime("%Y-%m-%d"))
    preencher(inputs[3], fim.strftime("%H:%M"))
    confirmar = painel + "//button[contains(@class,'ssc-picker-panel-footer-action-button') and normalize-space(.)='Confirmar']"
    clicar(driver, By.XPATH, confirmar)
    time.sleep(PAUSA_CLIQUE)


def alterar_pagina_para_50(driver) -> bool:
    """HTML confirmado: .ssc-pagination > .pager-option > .ssc-select-reference."""
    log.info("Configurando 50 artigos por página...")
    pagers = driver.find_elements(By.CSS_SELECTOR, ".ssc-pagination")
    pagers = [p for p in pagers if p.is_displayed()]
    if not pagers:
        log.info("Paginação não exibida; provavelmente não há dados.")
        return False
    pager = pagers[0]
    referencia = pager.find_element(By.CSS_SELECTOR, ".pager-option .ssc-select-reference")
    valor = referencia.find_element(By.CSS_SELECTOR, ".ssc-select-single-value").text.strip()
    if valor == "50 Artigo / Página":
        return True
    driver.execute_script("arguments[0].scrollIntoView({block:'center'});", referencia)
    time.sleep(PAUSA_CLIQUE)
    referencia.click()
    time.sleep(PAUSA_CLIQUE)
    opcao = WebDriverWait(driver, TIMEOUT).until(EC.visibility_of_element_located((By.CSS_SELECTOR, ".ssc-option[title='50 Artigo / Página']")))
    time.sleep(PAUSA_CLIQUE)
    opcao.click()
    time.sleep(4)
    log.info("50 artigos por página configurado.")
    return True


def aplicar_filtros(driver):
    inicio, fim, data, hora, turno = janela_working_time()
    separador()
    log.info(f"Janela: {inicio:%Y-%m-%d %H:%M} até {fim:%Y-%m-%d %H:%M} | hour: {hora:02d} | turno: {turno}")
    selecionar_packing(driver)
    preencher_working_time(driver, inicio, fim)
    log.info("Pesquisando...")
    clicar(driver, By.XPATH, "//button[contains(@class,'pro-filter-btn-confirm') and normalize-space(.)='Pesquisar']")
    time.sleep(PAUSA_APOS_PESQUISA)
    alterar_pagina_para_50(driver)
    return data, hora, turno


# ============================================================
# LEITURA ROBUSTA
# ============================================================
def obter_linhas_reais(driver) -> List:
    """Espera as linhas reais e considera qualquer tr com classe ssc-table-row."""
    limite = time.time() + 12
    ultima = []
    while time.time() < limite:
        linhas = driver.find_elements(By.CSS_SELECTOR, ".ssc-table-body tr[class*='ssc-table-row']")
        reais = []
        for linha in linhas:
            try:
                classe = linha.get_attribute("class") or ""
                if "first-row" in classe or "measure-cell" in classe:
                    continue
                reais.append(linha)
            except StaleElementReferenceException:
                continue
        if len(reais) >= len(ultima):
            ultima = reais
        # O total do pager serve apenas para aguardar a renderização; não é usado
        # para descartar linhas que possam ter células vazias.
        if reais:
            time.sleep(2)
            return reais
        time.sleep(0.5)
    return ultima


def valores_linha(linha) -> List[str]:
    valores = [celula.text.strip() for celula in linha.find_elements(By.CSS_SELECTOR, "td")]
    # Remove somente as células técnicas das extremidades. Mantém o vazio de saída.
    if len(valores) >= 11 and valores[0] == "":
        valores = valores[1:]
    if len(valores) >= 10 and valores[-1] == "":
        valores = valores[:-1]
    return valores


def ler_tabela(driver, data: str, hora: int, turno: str) -> List[Dict]:
    linhas = obter_linhas_reais(driver)
    log.info("Linhas encontradas: %d", len(linhas))
    dados_por_chave: Dict[Tuple[str, int, str, str, str], Dict] = {}
    sem_entrada = sem_ops = sem_estacao = invalidos = duplicados = 0

    for indice, linha in enumerate(linhas, 1):
        try:
            valores = valores_linha(linha)
            if len(valores) < 9:
                invalidos += 1
                log.warning("Linha %d ignorada: %d colunas úteis.", indice, len(valores))
                continue
            ops_id, workstation, grupo, atividade = [v.strip() for v in valores[0:4]]
            entrada = valores[7].strip()
            saida = valores[8].strip()
            if not entrada or entrada.lower() in {"-", "0", "null", "none"}:
                sem_entrada += 1
                continue
            if not ops_id:
                sem_ops += 1
                continue
            if not workstation:
                sem_estacao += 1
                continue
            item = {
                "ops_id": ops_id,
                "workstation": workstation,
                "grupo": grupo or "-",
                "atividade": atividade.lower(),
                "horas_trabalhadas": numero(valores[4]),
                "projecao_hora": numero(valores[5]),
                "processado": inteiro(valores[6]),
                "hora_entrada": timestamp_spx(entrada),
                "hora_saida": timestamp_spx(saida) if saida else None,
                "hour": hora,
                "date": data,
                "turno": turno,
            }
            chave = (data, hora, ops_id, workstation, turno)
            if chave in dados_por_chave:
                duplicados += 1
                # Para a mesma chave, mantém a entrada mais recente.
                anterior = dados_por_chave[chave]
                if (item["hora_entrada"] or "") >= (anterior["hora_entrada"] or ""):
                    dados_por_chave[chave] = item
            else:
                dados_por_chave[chave] = item
        except StaleElementReferenceException:
            invalidos += 1
        except Exception as erro:
            invalidos += 1
            log.warning("Linha %d ignorada: %s", indice, erro)

    dados = list(dados_por_chave.values())
    log.info("Válidos: %d | sem entrada: %d | sem OPS: %d | sem estação: %d | inválidos: %d | duplicados: %d", len(dados), sem_entrada, sem_ops, sem_estacao, invalidos, duplicados)
    return dados


# ============================================================
# SUPABASE
# ============================================================
def normalizar_chave(valor) -> str:
    return re.sub(r"\s+", " ", str(valor or "").strip()).casefold()


def filtros_chave(item: Dict):
    """Chave lógica: data + hora + ops_id + workstation + turno."""
    # workstation participa da identificação; duas estações diferentes nunca
    # devem atualizar a mesma linha.
    return (
        ("date", item["date"]),
        ("hour", item["hour"]),
        ("ops_id", item["ops_id"]),
        ("workstation", item["workstation"]),
        ("turno", item["turno"]),
    )

def salvar_supabase(dados: List[Dict]):
    """Atualiza ou insere pela chave date + hour + ops_id + workstation + turno."""
    if not dados:
        log.info("Nenhum registro para salvar.")
        return

    novos = 0
    substituidos = 0
    erros = 0

    for item in dados:
        try:
            filtros = filtros_chave(item)
            consulta = supabase.table(TABELA_SUPABASE).select("ops_id")
            for coluna, valor in filtros:
                consulta = consulta.eq(coluna, valor)
            existente = consulta.limit(1).execute()

            if existente.data:
                atualizacao = supabase.table(TABELA_SUPABASE).update(item)
                for coluna, valor in filtros:
                    atualizacao = atualizacao.eq(coluna, valor)
                atualizacao.execute()
                substituidos += 1
                log.debug("Atualizado: %s | workstation=%s", item["ops_id"], item["workstation"])
            else:
                supabase.table(TABELA_SUPABASE).insert(item).execute()
                novos += 1
                log.debug("Inserido: %s | workstation=%s", item["ops_id"], item["workstation"])

        except Exception as erro:
            erros += 1
            log.error(
                "Erro Supabase em ops_id=%s workstation=%s: %s",
                item.get("ops_id"), item.get("workstation"), erro,
            )

    log.info(
        "Supabase: %d novos | %d substituídos | %d erros",
        novos, substituidos, erros,
    )


def executar_ciclo(driver):
    log.info("Iniciando ciclo...")
    driver.refresh()
    time.sleep(3)
    data, hora, turno = aplicar_filtros(driver)
    dados = ler_tabela(driver, data, hora, turno)
    salvar_supabase(dados)


def iniciar_monitoramento():
    print("\nROBÔ SPX - PRODUTIVIDADE")
    print("Modo visual ativo | 2 segundos por clique")
    chrome_options = Options()
    # Executa o Chrome em segundo plano, sem abrir janela.
    chrome_options.add_argument("--headless=new")
    chrome_options.add_argument("--window-size=1920,1080")
    chrome_options.add_argument("--start-maximized")
    chrome_options.add_argument("--disable-notifications")
    chrome_options.add_argument("--disable-infobars")
    # chrome_options.add_argument("--headless=new")
    driver = None
    log.info("Modo headless ativo: Chrome será executado em segundo plano.")
    try:
        while True:
            try:
                driver = webdriver.Chrome(options=chrome_options)
                driver.set_page_load_timeout(60)
                fazer_login(driver)
                executar_ciclo(driver)
                try:
                    driver.quit()
                except Exception:
                    pass
                driver = None
                countdown(INTERVALO_SEGUNDOS)
            except KeyboardInterrupt:
                raise
            except TimeoutException as erro:
                log.error("Tempo excedido: %s", erro)
            except WebDriverException as erro:
                log.error("Erro Chrome/WebDriver: %s", erro)
            except Exception as erro:
                log.exception("Erro no ciclo: %s", erro)
            finally:
                if driver is not None:
                    try:
                        driver.quit()
                    except Exception:
                        pass
                    driver = None
            countdown(INTERVALO_SEGUNDOS)
    except KeyboardInterrupt:
        sys.stdout.write("\r" + " " * 80 + "\r")
        sys.stdout.flush()
        log.info("Execução interrompida pelo usuário.")
    finally:
        if driver is not None:
            try:
                driver.quit()
            except Exception:
                pass
        log.info("Chrome encerrado.")


if __name__ == "__main__":
    iniciar_monitoramento()
