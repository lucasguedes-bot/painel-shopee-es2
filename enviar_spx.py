import os
import time
import pandas as pd
from supabase import create_client, Client
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

# Configurações do Supabase
SUPABASE_URL = "https://qgjdzrroqvrxteeckazr.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFnamR6cnJvcXZyeHRlZWNrYXpyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Nzg0NjkxNywiZXhwIjoyMTAzNDIyOTE3fQ.U-pgfYabsJe_4bAnpZiSaphIfqeFjZGByvjsnlA8diY"

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

PASTA_PARA_MONITORAR = r"C:\Users\SEAOps\Downloads"

# Filtros para validar se o registro pertence ao fluxo de interesse
ATIVIDADES_PERMITIDAS = ["PACKING", "RECEIVED", "INBOUND", "P1", "P2", "LONA", "TERMO"]

def processar_e_enviar(caminho_arquivo):
    time.sleep(2)
    print(f"\n🔍 Novo relatório SPX detectado: {os.path.basename(caminho_arquivo)}")
    
    try:
        dfs = []
        if caminho_arquivo.endswith('.csv'):
            dfs.append(pd.read_csv(caminho_arquivo))
        else:
            excel_file = pd.ExcelFile(caminho_arquivo)
            for sheet in excel_file.sheet_names:
                df_sheet = pd.read_excel(excel_file, sheet_name=sheet)
                dfs.append(df_sheet)

        df_completo = pd.concat(dfs, ignore_index=True)
        df_completo = df_completo.fillna('')

        dados = []

        for _, row in df_completo.iterrows():
            atividade = str(row.get('Tipo de Atividade', '')).strip()
            workstation = str(row.get('ID/Nome da Estação de Trabalho', '')).strip()
            ops_id = str(row.get('OPS ID', '')).strip()

            # Mapeamento do SPX
            if "received" in atividade.lower():
                atividade = "INBOUND"
            if "termo" in workstation.lower() or "termo" in atividade.lower():
                workstation = f"P2_{workstation}"
            if "lona" in workstation.lower() or "lona" in atividade.lower():
                workstation = f"P1_{workstation}"

            # Filtra registros aceitos
            if any(atv.lower() in atividade.lower() or atv.lower() in workstation.lower() for atv in ATIVIDADES_PERMITIDAS) or not ATIVIDADES_PERMITIDAS:
                item = {
                    "ops_id": ops_id,
                    "workstation": workstation,
                    "grupo": str(row.get('ID/Nome do Grupo de Estações de Trabalho', '')),
                    "atividade": atividade,
                    "horas_trabalhadas": float(row.get('Horas de Trabalho (mnhr)', 0)) if row.get('Horas de Trabalho (mnhr)', '') != '' else 0.0,
                    "projecao_hora": float(row.get('Produtividade Horária (pedido/mnhr)', 0)) if row.get('Produtividade Horária (pedido/mnhr)', '') != '' else 0.0,
                    "processado": int(row.get('Total de Processamento (pedidos)', 0)) if row.get('Total de Processamento (pedidos)', '') != '' else 0,
                    "hora_entrada": str(row.get('Hora de Entrada', '')),
                    "hora_saida": str(row.get('Hora de Saída', ''))
                }
                dados.append(item)

        if dados:
            supabase.table("spx").insert(dados).execute()
            print(f"✅ SUCESSO! {len(dados)} registros do SPX processados e enviados ao Supabase!")
        else:
            print("⚠️ Nenhuma linha correspondente aos filtros do SPX foi encontrada.")

    except Exception as e:
        print(f"❌ Erro ao ler/enviar o arquivo: {e}")

class MonitoradorDeArquivos(FileSystemEventHandler):
    def on_created(self, event):
        if not event.is_directory and (event.src_path.endswith('.xlsx') or event.src_path.endswith('.csv')):
            processar_e_enviar(event.src_path)

if __name__ == "__main__":
    event_handler = MonitoradorDeArquivos()
    observer = Observer()
    observer.schedule(event_handler, path=PASTA_PARA_MONITORAR, recursive=False)
    
    print("🤖 ROBÔ SPX INICIADO!")
    print(f"Monitorando Downloads em: {PASTA_PARA_MONITORAR}")
    print("Mapeamento ativo: LONA=P1 | TERMO=P2 | RECEIVED=INBOUND\n")
    
    observer.start()
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()