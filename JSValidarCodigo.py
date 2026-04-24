import subprocess
import json
from langchain.tools import tool # O el decorador de tu framework

@tool
def validar_codigo_nextjs(codigo_fuente: str) -> str:
    """
    ÚSALA SIEMPRE ANTES DE APROBAR CÓDIGO DE NEXT.JS.
    Analiza el código generado en busca de funciones vacías o TODOs pendientes.
    Devuelve un JSON con los errores encontrados.
    """
    # Guardar el código temporalmente
    with open("temp_code.js", "w") as f:
        f.write(codigo_fuente)
    
    # Ejecutar el script de Node.js que contiene la lógica de Babel
    resultado = subprocess.run(
        ["node", "auditor_babel.js", "temp_code.js"], 
        capture_output=True, 
        text=True
    )
    
    # Devolver el resultado de la consola al Agente Orquestador
    return resultado.stdout