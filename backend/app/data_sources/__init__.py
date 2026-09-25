from typing import Dict
from app.data_sources.base import BaseDataSource, DataSourceType, ProviderStatus
from app.data_sources.open_meteo import OpenMeteoSource
from app.data_sources.tomorrow import TomorrowIOSource
from app.data_sources.imd import IMDSource
from app.data_sources.gpm_imerg import NasaGpmSource
from app.data_sources.bmc_gis import BmcGisSource
from app.data_sources.osm import OsmSource
from app.data_sources.dem import DemSource
from app.data_sources.mcgm_rain_gauges import McgmRainGaugeSource
from app.data_sources.imd_radar import ImdRadarSource

# Singleton registry of initialized data source providers
PROVIDERS: Dict[str, BaseDataSource] = {
    "open_meteo": OpenMeteoSource(),
    "tomorrow_io": TomorrowIOSource(),
    "imd": IMDSource(),
    "nasa_gpm": NasaGpmSource(),
    "bmc_gis": BmcGisSource(),
    "osm": OsmSource(),
    "dem_copernicus": DemSource(),
    "mcgm_rain_gauges": McgmRainGaugeSource(),
    "imd_radar": ImdRadarSource(),
}

__all__ = [
    "BaseDataSource",
    "DataSourceType",
    "ProviderStatus",
    "OpenMeteoSource",
    "TomorrowIOSource",
    "IMDSource",
    "NasaGpmSource",
    "BmcGisSource",
    "OsmSource",
    "DemSource",
    "McgmRainGaugeSource",
    "ImdRadarSource",
    "PROVIDERS",
]
